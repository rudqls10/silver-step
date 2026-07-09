/**
 * TeachableMachinePoseDetector - Google Teachable Machine Pose 연동 모듈
 * 사전 학습된 포즈 모델을 로드하여 3클래스 분류를 수행합니다.
 * 
 * 의존성 (CDN으로 HTML에서 로드):
 *   - @tensorflow/tfjs
 *   - @teachablemachine/pose
 *
 * 사용법:
 *   const detector = new TeachableMachinePoseDetector(canvasEl, {
 *     modelURL: 'https://teachablemachine.withgoogle.com/models/xxxxx/',
 *     onClassification: (results) => { ... },
 *   });
 *   await detector.init();
 *   await detector.start();
 */
export class TeachableMachinePoseDetector {
  /**
   * @param {HTMLCanvasElement} canvasElement - 포즈 오버레이 캔버스
   * @param {Object} options
   * @param {string} options.modelURL - Teachable Machine 모델 URL
   * @param {Function} options.onClassification - 분류 결과 콜백
   * @param {Function} options.onPoseState - 포즈 상태 콜백 (MediaPipe 호환)
   * @param {Function} options.onFpsUpdate - FPS 업데이트 콜백
   */
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.model = null;
    this.webcam = null;
    this.isRunning = false;

    // 모델 URL
    this.modelURL = options.modelURL || '';

    // FPS 계산
    this.fps = 0;
    this._lastFpsTime = 0;
    this._frameCount = 0;

    // 클래스 매핑 (Teachable Machine 클래스명 → 앱 상태)
    this.classMapping = options.classMapping || {
      'Standing': 'UP',
      'Squatting': 'DOWN',
      'Away': 'NOT_DETECTED',
      // 한글 클래스명 대응
      '서기': 'UP',
      '앉기': 'DOWN',
      '이탈': 'NOT_DETECTED',
    };

    // Callbacks
    this.onClassification = options.onClassification || (() => {});
    this.onPoseState = options.onPoseState || (() => {});
    this.onFpsUpdate = options.onFpsUpdate || (() => {});
  }

  /**
   * Teachable Machine 모델 초기화
   * @param {string} [modelURL] - 모델 URL (생성자에서 전달하지 않은 경우)
   */
  async init(modelURL) {
    if (modelURL) this.modelURL = modelURL;

    if (!this.modelURL) {
      throw new Error('[TeachableMachine] 모델 URL이 필요합니다.');
    }

    /* global tmPose */
    const modelPath = this.modelURL + 'model.json';
    const metadataPath = this.modelURL + 'metadata.json';

    try {
      this.model = await tmPose.load(modelPath, metadataPath);
      console.log('[TeachableMachine] 모델 로드 완료');
      console.log('[TeachableMachine] 클래스:', this.model.getClassLabels());
    } catch (e) {
      console.error('[TeachableMachine] 모델 로드 실패:', e);
      throw e;
    }

    // Teachable Machine 웹캠 설정
    const width = 640;
    const height = 480;
    const flip = true; // 거울 모드
    this.webcam = new tmPose.Webcam(width, height, flip);
    await this.webcam.setup();

    console.log('[TeachableMachine] 초기화 완료');
  }

  /**
   * 인식 시작
   */
  async start() {
    await this.webcam.play();
    this.isRunning = true;
    this._loop();
    console.log('[TeachableMachine] 시작');
  }

  /**
   * 인식 중지
   */
  stop() {
    this.isRunning = false;
    if (this.webcam) {
      this.webcam.stop();
    }
    console.log('[TeachableMachine] 중지');
  }

  /**
   * 인식 루프
   * @private
   */
  async _loop() {
    if (!this.isRunning) return;

    this.webcam.update();
    await this._predict();
    this._updateFps();

    window.requestAnimationFrame(() => this._loop());
  }

  /**
   * 포즈 분류 실행
   * @private
   */
  async _predict() {
    if (!this.model || !this.webcam) return;

    // 포즈 추정 + 분류
    const { pose, posenetOutput } = await this.model.estimatePose(this.webcam.canvas);
    const predictions = await this.model.predict(posenetOutput);

    // 캔버스에 그리기
    this._draw(pose);

    // 분류 결과 가공
    const results = predictions.map(p => ({
      className: p.className,
      probability: p.probability,
    }));

    // 가장 높은 확률의 클래스
    const topResult = results.reduce((max, r) =>
      r.probability > max.probability ? r : max
    , results[0]);

    // MediaPipe 호환 상태로 변환
    const mappedState = this.classMapping[topResult.className] || 'TRANSITIONING';

    this.onClassification(results);
    this.onPoseState({
      detected: mappedState !== 'NOT_DETECTED',
      state: mappedState,
      className: topResult.className,
      confidence: Math.round(topResult.probability * 100),
      kneeAngle: 0, // TM은 각도 계산 없음
      leftKneeAngle: 0,
      rightKneeAngle: 0,
    });
  }

  /**
   * 포즈를 캔버스에 그리기
   * @private
   */
  _draw(pose) {
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);

    // 웹캠 이미지
    this.ctx.drawImage(this.webcam.canvas, 0, 0, width, height);

    // 포즈 키포인트 그리기
    if (pose) {
      const minConfidence = 0.2;
      /* global tmPose */
      if (typeof tmPose !== 'undefined' && tmPose.drawKeypoints) {
        tmPose.drawKeypoints(pose.keypoints, minConfidence, this.ctx);
        tmPose.drawSkeleton(pose.keypoints, minConfidence, this.ctx);
      }
    }
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
   * 캔버스 크기 조정
   */
  resizeCanvas() {
    this.canvas.width = 640;
    this.canvas.height = 480;
  }
}
