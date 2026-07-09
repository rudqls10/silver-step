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

    // 카메라 연결
    this.camera = new Camera(this.video, {
      onFrame: async () => {
        if (this.isRunning) {
          await this.pose.send({ image: this.video });
        }
      },
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
   * MediaPipe 결과 처리 콜백
   * @private
   */
  _onResults(results) {
    this._updateFps();

    const { width, height } = this.canvas;
    this.ctx.save();
    this.ctx.clearRect(0, 0, width, height);

    if (this.blurBackground) {
      // 블러 모드: 어두운 배경만 그리고 스켈레톤만 선명하게
      this.ctx.fillStyle = 'rgba(10, 14, 23, 0.85)';
      this.ctx.fillRect(0, 0, width, height);

      // 반투명 카메라 이미지 (실루엣 느낌)
      this.ctx.globalAlpha = 0.08;
      this.ctx.drawImage(results.image, 0, 0, width, height);
      this.ctx.globalAlpha = 1.0;
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

    // 상태별 색상
    const stateColors = {
      'UP': { line: '#00E676', joint: '#00E676', glow: 'rgba(0, 230, 118, 0.5)' },
      'DOWN': { line: '#FF9100', joint: '#FF9100', glow: 'rgba(255, 145, 0, 0.5)' },
      'TRANSITIONING': { line: '#448AFF', joint: '#448AFF', glow: 'rgba(68, 138, 255, 0.5)' },
      'NOT_DETECTED': { line: '#448AFF', joint: '#448AFF', glow: 'rgba(68, 138, 255, 0.5)' },
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

    // 주요 관절 강조 (어깨, 팔꿈치, 손목)
    const keyJoints = [11, 12, 13, 14, 15, 16]; // 양쪽 어깨, 팔꿈치, 손목
    const keyLandmarks = keyJoints.map(i => landmarks[i]);
    drawLandmarks(this.ctx, keyLandmarks, {
      color: '#ffffff',
      lineWidth: 2,
      radius: this.blurBackground ? 10 : 8,
      fillColor: colors.glow,
    });
  }

  /**
   * 포즈 상태 분석 (만세 동작 판별)
   * @private
   * @param {Array} landmarks - 33개 관절 랜드마크
   * @returns {Object} 포즈 상태 정보
   */
  _analyzePose(landmarks) {
    // MediaPipe Pose 랜드마크 인덱스:
    // 11/12: 왼쪽/오른쪽 어깨
    // 13/14: 왼쪽/오른쪽 팔꿈치
    // 15/16: 왼쪽/오른쪽 손목
    // 23/24: 왼쪽/오른쪽 엉덩이

    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftElbow = landmarks[13];
    const rightElbow = landmarks[14];
    const leftWrist = landmarks[15];
    const rightWrist = landmarks[16];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    // 기준선 계산 (MediaPipe에서 y는 위로 갈수록 작아짐)
    const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const hipY = (leftHip.y + rightHip.y) / 2;
    const bodyLength = hipY - shoulderY; // 어깨~엉덩이 길이 (정규화 기준)

    // UP 기준: 손목이 어깨보다 위 (마진 포함 - 체형 대비 10%)
    const upThresholdY = shoulderY - bodyLength * 0.1;
    // DOWN 기준: 손목이 어깨보다 확실히 아래 (체형 대비 30%)
    const downThresholdY = shoulderY + bodyLength * 0.3;

    const leftWristUp = leftWrist.y < upThresholdY;
    const rightWristUp = rightWrist.y < upThresholdY;
    const leftWristDown = leftWrist.y > downThresholdY;
    const rightWristDown = rightWrist.y > downThresholdY;

    // 팔꿈치도 보조 지표로 활용 (팔꿈치가 어깨 위면 확실한 UP)
    const elbowsUp = leftElbow.y < shoulderY && rightElbow.y < shoulderY;

    // 가시성(Visibility) 확인
    const visibility = [leftShoulder, rightShoulder, leftWrist, rightWrist, leftHip, rightHip]
      .reduce((sum, lm) => sum + (lm.visibility || 0), 0) / 6;

    // 포즈 상태 판별
    let state = 'TRANSITIONING';
    if ((leftWristUp && rightWristUp) || (elbowsUp && leftWristUp) || (elbowsUp && rightWristUp)) {
      state = 'UP';   // 만세 자세 (팔이 어깨 위로 올라감)
    } else if (leftWristDown && rightWristDown) {
      state = 'DOWN'; // 내린 자세 (팔이 확실히 내려감)
    }

    // 디버그용: 손목 높이 (양수=어깨 위, 음수=어깨 아래)
    const leftHeight = Math.round((shoulderY - leftWrist.y) * 100);
    const rightHeight = Math.round((shoulderY - rightWrist.y) * 100);

    return {
      detected: true,
      state,
      kneeAngle: 0,
      leftKneeAngle: leftHeight,   // 디버그: 왼손목 높이
      rightKneeAngle: rightHeight,  // 디버그: 오른손목 높이
      confidence: Math.round(visibility * 100),
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
