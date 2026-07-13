/**
 * MediaPipePoseDetector - MediaPipe Pose 연동 모듈
 * 33개 관절 랜드마크를 실시간 추적하고 운동 상태(UP/DOWN)를 판별합니다.
 *
 * 의존성 (CDN으로 HTML에서 로드):
 *   - @mediapipe/pose
 *   - @mediapipe/camera_utils
 *   - @mediapipe/drawing_utils
 *
 * 사용법:
 *   const detector = new MediaPipePoseDetector(videoEl, canvasEl, {
 *     onPoseState: (state) => { ... },
 *     onFpsUpdate: (fps) => { ... },
 *   });
 *   await detector.init();
 *   await detector.start();
 */
import { ExerciseType, getExerciseConfig } from './exercises.js';
export class MediaPipePoseDetector {
  /**
   * @param {HTMLVideoElement} videoElement - 카메라 비디오 엘리먼트
   * @param {HTMLCanvasElement} canvasElement - 포즈 오버레이 캔버스
   * @param {Object} options
   * @param {Function} options.onPoseState - 포즈 상태 변경 콜백
   * @param {Function} options.onFpsUpdate - FPS 업데이트 콜백
   * @param {Function} options.onLandmarks - 랜드마크 데이터 콜백
   * @param {number} options.standingAngle - 서 있는 상태 각도 임계값 (기본: 160)
   * @param {number} options.squattingAngle - 앉은 상태 각도 임계값 (기본: 100)
   * @param {boolean} options.drawSkeleton - 스켈레톤 그리기 여부 (기본: true)
   * @param {boolean} options.blurBackground - 배경 블러 여부 (기본: false)
   */
  constructor(videoElement, canvasElement, options = {}) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.pose = null;
    this.camera = null;
    this.isRunning = false;

    // FPS 계산
    this.fps = 0;
    this._lastFpsTime = 0;
    this._frameCount = 0;

    // 옵션
    this.drawSkeleton = options.drawSkeleton !== false;
    this.blurBackground = options.blurBackground || false;

    // 현재 포즈 상태 (스켈레톤 색상용)
    this._currentPoseState = 'NOT_DETECTED';

    // 현재 운동 타입
    this.exerciseType = options.exerciseType || ExerciseType.MANSE;
    this._exerciseConfig = getExerciseConfig(this.exerciseType);

    // 각도 임계값
    this.standingAngle = options.standingAngle || 160;
    this.squattingAngle = options.squattingAngle || 100;

    // Callbacks
    this.onPoseState = options.onPoseState || (() => {});
    this.onFpsUpdate = options.onFpsUpdate || (() => {});
    this.onLandmarks = options.onLandmarks || (() => {});
  }

  /**
   * MediaPipe Pose 초기화
   */
  async init() {
    /* global Pose, Camera, drawConnectors, drawLandmarks, POSE_CONNECTIONS */

    this.pose = new Pose({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
      }
    });

    this.pose.setOptions({
      modelComplexity: 1,       // 0=lite, 1=full, 2=heavy
      smoothLandmarks: true,
      enableSegmentation: false,
      smoothSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    this.pose.onResults((results) => this._onResults(results));

    // 카메라 연결 (모바일: 전면 카메라 사용)
    this.camera = new Camera(this.video, {
      onFrame: async () => {
        if (this.isRunning) {
          await this.pose.send({ image: this.video });
        }
      },
      facingMode: 'user',  // 전면 카메라
      width: 640,
      height: 480,
    });

    console.log('[MediaPipe] 초기화 완료');
  }

  /**
   * 카메라 시작
   */
  async start() {
    this.isRunning = true;
    await this.camera.start();
    console.log('[MediaPipe] 카메라 시작');
  }

  /**
   * 카메라 중지
   */
  stop() {
    this.isRunning = false;
    if (this.camera) {
      this.camera.stop();
    }
    console.log('[MediaPipe] 카메라 중지');
  }

  /**
   * 운동 타입 변경
   * @param {string} exerciseType - ExerciseType 값
   */
  setExerciseType(exerciseType) {
    this.exerciseType = exerciseType;
    this._exerciseConfig = getExerciseConfig(exerciseType);
    console.log(`[MediaPipe] 운동 타입 변경: ${this._exerciseConfig.name}`);
  }

  /**
   * MediaPipe 결과 처리 콜백
   * @private
   */
  _onResults(results) {
    this._updateFps();

    const { width, height } = this.canvas;
    this.ctx.save();
    this.ctx.clearRect(0, 0, width, height);

    if (this.blurBackground) {
      // 블러 모드: 밝은 카메라 이미지에 가우시안 블러 적용
      this.ctx.filter = 'blur(14px) brightness(1.4) saturate(1.1)';
      this.ctx.drawImage(results.image, 0, 0, width, height);
      this.ctx.filter = 'none';

      // 밝은 반투명 오버레이 (프라이버시 보호 + 따뜻한 톤 유지)
      this.ctx.fillStyle = 'rgba(255, 249, 242, 0.15)';
      this.ctx.fillRect(0, 0, width, height);
    } else {
      // 일반 모드: 카메라 이미지 그대로
      this.ctx.drawImage(results.image, 0, 0, width, height);
    }

    if (results.poseLandmarks) {
      // 스켈레톤 그리기
      if (this.drawSkeleton) {
        this._drawPose(results.poseLandmarks);
      }

      // 포즈 분석
      const poseState = this._analyzePose(results.poseLandmarks);
      this._currentPoseState = poseState.state;
      this.onPoseState(poseState);
      this.onLandmarks(results.poseLandmarks);
    } else {
      this._currentPoseState = 'NOT_DETECTED';
      this.onPoseState({
        detected: false,
        state: 'NOT_DETECTED',
        kneeAngle: 0,
        leftKneeAngle: 0,
        rightKneeAngle: 0,
        confidence: 0,
      });
    }

    this.ctx.restore();
  }

  /**
   * 포즈 랜드마크를 캔버스에 그리기 (얼굴 랜드마크 제외)
   * 상태에 따라 색상 변경: UP=초록, DOWN=주황, TRANSITIONING=파랑
   * @private
   */
  _drawPose(landmarks) {
    /* global drawConnectors, drawLandmarks, POSE_CONNECTIONS */

    // 상태별 색상 (따뜻한 테마)
    const stateColors = {
      'UP': { line: '#4CAF50', joint: '#4CAF50', glow: 'rgba(76, 175, 80, 0.5)' },
      'DOWN': { line: '#FF7043', joint: '#FF7043', glow: 'rgba(255, 112, 67, 0.5)' },
      'TRANSITIONING': { line: '#42A5F5', joint: '#42A5F5', glow: 'rgba(66, 165, 245, 0.5)' },
      'NOT_DETECTED': { line: '#42A5F5', joint: '#42A5F5', glow: 'rgba(66, 165, 245, 0.5)' },
    };

    const colors = stateColors[this._currentPoseState] || stateColors['NOT_DETECTED'];

    // 얼굴 랜드마크 인덱스 (0~10) 제외 필터
    const FACE_INDICES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // 얼굴 관련 연결선 제외
    const bodyConnections = POSE_CONNECTIONS.filter(
      ([a, b]) => !FACE_INDICES.has(a) && !FACE_INDICES.has(b)
    );

    // 글로우 효과 (블러 모드에서 더 강하게)
    if (this.blurBackground) {
      this.ctx.shadowColor = colors.glow;
      this.ctx.shadowBlur = 15;
    }

    // 몸통 연결선만 그리기
    drawConnectors(this.ctx, landmarks, bodyConnections, {
      color: colors.line,
      lineWidth: this.blurBackground ? 4 : 3,
    });

    // 글로우 리셋
    this.ctx.shadowBlur = 0;

    // 몸통 관절점만 그리기 (11번 이후)
    const bodyLandmarks = landmarks.filter((_, i) => !FACE_INDICES.has(i));
    drawLandmarks(this.ctx, bodyLandmarks, {
      color: colors.joint,
      lineWidth: 1,
      radius: this.blurBackground ? 6 : 5,
      fillColor: colors.joint,
    });

    // 현재 운동에 맞는 주요 관절 강조
    const keyJoints = this._exerciseConfig.highlightJoints || [11, 12, 13, 14, 15, 16];
    const keyLandmarks = keyJoints.map(i => landmarks[i]);
    drawLandmarks(this.ctx, keyLandmarks, {
      color: '#ffffff',
      lineWidth: 2,
      radius: this.blurBackground ? 10 : 8,
      fillColor: colors.glow,
    });
  }

  /**
   * 포즈 상태 분석 (현재 운동 타입에 따라 분석 위임)
   * @private
   * @param {Array} landmarks - 33개 관절 랜드마크
   * @returns {Object} 포즈 상태 정보
   */
  _analyzePose(landmarks) {
    // exercises.js의 analyze 함수에 위임
    const result = this._exerciseConfig.analyze(landmarks);

    // 기존 인터페이스 호환을 위해 필드 매핑
    return {
      detected: result.detected,
      state: result.state,
      kneeAngle: 0,
      leftKneeAngle: result.leftDebugValue,
      rightKneeAngle: result.rightDebugValue,
      confidence: result.confidence,
    };
  }

  /**
   * 세 점(a-b-c)에서 b 기준 각도 계산 (도 단위)
   * @private
   */
  _calculateAngle(a, b, c) {
    const radians =
      Math.atan2(c.y - b.y, c.x - b.x) -
      Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180) angle = 360 - angle;
    return angle;
  }

  /**
   * FPS 계산
   * @private
   */
  _updateFps() {
    this._frameCount++;
    const now = performance.now();
    if (now - this._lastFpsTime >= 1000) {
      this.fps = this._frameCount;
      this._frameCount = 0;
      this._lastFpsTime = now;
      this.onFpsUpdate(this.fps);
    }
  }

  /**
   * 캔버스 크기를 비디오에 맞추기
   */
  resizeCanvas() {
    this.canvas.width = this.video.videoWidth || 640;
    this.canvas.height = this.video.videoHeight || 480;
  }
}
