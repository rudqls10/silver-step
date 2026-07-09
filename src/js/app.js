/**
 * SilverStepApp - 실버스텝 앱 메인 로직 (상태 머신)
 *
 * 상태 흐름:
 *   IDLE → GREETING → WAITING_POSE → COUNTDOWN → EXERCISING → COMPLETE
 *
 * 각 모듈 연결:
 *   - MediaPipePoseDetector: 포즈 인식
 *   - AudioManager: 음성 안내
 *   - ExerciseCounter: 운동 카운팅
 */
import { MediaPipePoseDetector } from './pose-mediapipe.js';
import { AudioManager } from './audio.js';
import { ExerciseCounter } from './counter.js';

// ============================
// 앱 상태 정의
// ============================
const AppState = Object.freeze({
  IDLE:         'IDLE',
  GREETING:     'GREETING',
  WAITING_POSE: 'WAITING_POSE',
  COUNTDOWN:    'COUNTDOWN',
  EXERCISING:   'EXERCISING',
  COMPLETE:     'COMPLETE',
});

class SilverStepApp {
  constructor() {
    this.state = AppState.IDLE;
    this.detector = null;
    this.audio = null;
    this.counter = null;

    // DOM 요소
    this.dom = {};

    // 설정
    this.config = {
      targetCount: 10,      // 목표 운동 횟수
      milestones: [5],       // 격려 메시지 트리거
      countdownSeconds: 3,   // 카운트다운 시간
      poseHoldTime: 1500,    // 포즈 유지 시간 (ms) - 안심위치 확인용
      poseLostWarningTime: 5000, // 포즈 미감지 경고 시간 (ms)
    };

    // 포즈 유지 타이머
    this._poseHoldTimer = null;
    this._poseDetectedTime = null;

    // 운동 시작 시간 (통계용)
    this._exerciseStartTime = null;

    // 운동 타이머 인터벌
    this._timerInterval = null;

    // 포즈 미감지 추적
    this._lastPoseDetectedTime = null;
    this._poseLostWarned = false;
  }

  /**
   * 앱 초기화
   */
  async init() {
    console.log('[App] 실버스텝 MVP 초기화 시작');

    // DOM 요소 바인딩
    this._bindDOM();

    // 오디오 매니저 초기화
    this.audio = new AudioManager();

    // 운동 카운터 초기화
    this.counter = new ExerciseCounter({
      targetCount: this.config.targetCount,
      milestones: this.config.milestones,
      onCountUpdate: (count, target) => this._onCountUpdate(count, target),
      onMilestone: (count) => this._onMilestone(count),
      onComplete: (count) => this._onComplete(count),
      onCountBeep: () => this.audio.playCountBeep(),
    });

    // 포즈 감지기 초기화
    const video = this.dom.video;
    const canvas = this.dom.canvas;
    this.detector = new MediaPipePoseDetector(video, canvas, {
      drawSkeleton: true,
      blurBackground: true,  // 2주차: 프라이버시 블러 기본 활성화
      onPoseState: (state) => this._onPoseState(state),
      onFpsUpdate: (fps) => this._onFpsUpdate(fps),
    });

    try {
      await this.detector.init();
    } catch (error) {
      console.error('[App] MediaPipe 초기화 실패:', error);
      this._showError('AI 모델 로딩에 실패했습니다. 페이지를 새로고침해 주세요.');
      return;
    }

    // 시작 버튼 이벤트
    this.dom.startButton.addEventListener('click', () => this.start());
    this.dom.restartButton.addEventListener('click', () => this.restart());

    // 자녀 알림 버튼 이벤트
    if (this.dom.notifyButton) {
      this.dom.notifyButton.addEventListener('click', () => this._sendNotification());
    }

    // 에러 재시도 버튼
    if (this.dom.errorRetryButton) {
      this.dom.errorRetryButton.addEventListener('click', () => this._retryFromError());
    }

    // 초기 상태 설정
    this._setState(AppState.IDLE);
    this._updateMessage('시작 버튼을 눌러주세요');

    console.log('[App] 초기화 완료');
  }

  /**
   * 앱 시작 (시작 버튼 클릭 후)
   */
  async start() {
    try {
      // 카메라 시작
      await this.detector.start();
      this.detector.resizeCanvas();
    } catch (error) {
      console.error('[App] 카메라 시작 실패:', error);
      this._showError('카메라를 사용할 수 없습니다. 카메라 권한을 확인해 주세요.');
      return;
    }

    // 시작 화면 숨기기
    this.dom.startScreen.classList.add('hidden');

    // 인사 상태로 전환
    this._setState(AppState.GREETING);
    await this.audio.speak(AudioManager.MESSAGES.GREETING);

    // 인사 완료 → 포즈 대기
    this._setState(AppState.WAITING_POSE);
    this._updateMessage('초록색 위치에 서 주세요');
  }

  /**
   * 앱 재시작
   */
  async restart() {
    this.counter.reset();
    this._poseHoldTimer = null;
    this._poseDetectedTime = null;
    this._exerciseStartTime = null;
    this._lastPoseDetectedTime = null;
    this._poseLostWarned = false;

    // 타이머 중지
    this._stopTimer();

    // UI 초기화
    this.dom.completeScreen.classList.remove('active');
    this.dom.countdownOverlay.classList.remove('active');
    if (this.dom.exerciseType) this.dom.exerciseType.classList.remove('active');
    if (this.dom.exerciseTimer) this.dom.exerciseTimer.classList.remove('active');
    if (this.dom.messageDisplay) this.dom.messageDisplay.classList.remove('warning');

    // 알림 버튼 초기화
    if (this.dom.notifyButton) {
      this.dom.notifyButton.classList.remove('sent');
      this.dom.notifyButton.innerHTML = '📱 자녀에게 알림 보내기';
      this.dom.notifyButton.disabled = false;
    }

    this._updateCount(0);
    this._updateProgress(0);

    // 다시 인사부터
    this._setState(AppState.GREETING);
    await this.audio.speak(AudioManager.MESSAGES.GREETING);
    this._setState(AppState.WAITING_POSE);
    this._updateMessage('초록색 위치에 서 주세요');
  }

  // ============================
  // 상태 관리
  // ============================

  /**
   * 상태 전환
   * @private
   */
  _setState(newState) {
    const prevState = this.state;
    this.state = newState;
    console.log(`[App] 상태 전환: ${prevState} → ${newState}`);

    // 상태 표시 업데이트
    this._updateStatusDot(newState);
    this._updateStatusText(newState);
  }

  // ============================
  // 이벤트 핸들러
  // ============================

  /**
   * 포즈 상태 변경 처리
   * @private
   */
  _onPoseState(poseData) {
    // 디버그 정보 업데이트
    this._updateDebug(poseData);

    switch (this.state) {
      case AppState.WAITING_POSE:
        this._handleWaitingPose(poseData);
        break;

      case AppState.EXERCISING:
        this._handleExercising(poseData);
        break;

      default:
        break;
    }
  }

  /**
   * 포즈 대기 상태 처리
   * 사용자가 안심 위치에 서면 카운트다운 시작
   * @private
   */
  _handleWaitingPose(poseData) {
    if (poseData.detected && poseData.state === 'UP') {
      if (!this._poseDetectedTime) {
        this._poseDetectedTime = Date.now();
        this._updateMessage('좋은 자세입니다. 잠시만 유지해주세요...');
      }

      // 포즈 유지 시간 확인
      const holdDuration = Date.now() - this._poseDetectedTime;
      if (holdDuration >= this.config.poseHoldTime) {
        this._poseDetectedTime = null;
        this._startCountdown();
      }
    } else {
      // 포즈가 사라지면 타이머 리셋
      this._poseDetectedTime = null;
      if (poseData.detected) {
        this._updateMessage('초록색 위치에 서 주세요');
      } else {
        this._updateMessage('카메라에 전신이 보이게 서 주세요');
      }
    }
  }

  /**
   * 카운트다운 시작
   * @private
   */
  async _startCountdown() {
    this._setState(AppState.COUNTDOWN);
    this.dom.countdownOverlay.classList.add('active');

    for (let i = this.config.countdownSeconds; i >= 1; i--) {
      this.dom.countdownNumber.textContent = i;
      this.dom.countdownNumber.style.animation = 'none';
      // 애니메이션 리트리거
      void this.dom.countdownNumber.offsetHeight;
      this.dom.countdownNumber.style.animation = 'countPop 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)';

      await this.audio.speak(String(i), { rate: 1.2 });
      await this._delay(300);
    }

    this.dom.countdownOverlay.classList.remove('active');

    // 운동 시작!
    this._setState(AppState.EXERCISING);
    this._exerciseStartTime = Date.now();
    this._lastPoseDetectedTime = Date.now();
    this._poseLostWarned = false;

    // 운동 종류 표시
    if (this.dom.exerciseType) {
      this.dom.exerciseType.classList.add('active');
    }

    // 타이머 시작
    this._startTimer();

    await this.audio.speak(AudioManager.MESSAGES.START);
    this._updateMessage('운동을 시작하세요!');
  }

  /**
   * 운동 중 포즈 처리
   * @private
   */
  _handleExercising(poseData) {
    if (poseData.detected) {
      this._lastPoseDetectedTime = Date.now();
      this._poseLostWarned = false;

      // 경고 스타일 제거
      if (this.dom.messageDisplay) {
        this.dom.messageDisplay.classList.remove('warning');
      }

      this.counter.update(poseData.state);
    } else {
      // 포즈 미감지 경고 체크
      this._checkPoseLost();
    }
  }

  /**
   * 포즈 미감지 경고 (5초 이상)
   * @private
   */
  _checkPoseLost() {
    if (!this._lastPoseDetectedTime) return;

    const lostDuration = Date.now() - this._lastPoseDetectedTime;

    if (lostDuration >= this.config.poseLostWarningTime && !this._poseLostWarned) {
      this._poseLostWarned = true;
      this._updateMessage('카메라 앞에 서 주세요');

      // 경고 스타일 적용
      if (this.dom.messageDisplay) {
        this.dom.messageDisplay.classList.add('warning');
      }

      // 음성 경고
      this.audio.speak(AudioManager.MESSAGES.POSE_LOST);

      console.log('[App] 포즈 미감지 경고 발생');
    }
  }

  /**
   * 카운트 업데이트 콜백
   * @private
   */
  _onCountUpdate(count, target) {
    this._updateCount(count);
    this._updateProgress(count / target);
    this._updateMessage(`${count}번 완료!`);

    // 카운트 증가 애니메이션
    this.dom.countNumber.classList.add('bump');
    setTimeout(() => this.dom.countNumber.classList.remove('bump'), 300);
  }

  /**
   * 마일스톤 도달 콜백
   * @private
   */
  async _onMilestone(count) {
    console.log(`[App] 마일스톤: ${count}회`);

    // 마일스톤 효과음
    this.audio.playMilestoneSound();

    // 랜덤 격려 메시지 or 기본 메시지
    const pool = AudioManager.ENCOURAGE_POOL;
    const randomMsg = pool[Math.floor(Math.random() * pool.length)];

    this._updateMessage(`${count}번 성공! 조금만 더 힘내세요!`);
    await this.audio.speak(randomMsg);
  }

  /**
   * 운동 완료 콜백
   * @private
   */
  async _onComplete(count) {
    console.log(`[App] 운동 완료: ${count}회`);
    this._setState(AppState.COMPLETE);

    // 타이머 중지
    this._stopTimer();

    // 운동 시간 계산
    const duration = this._exerciseStartTime
      ? Math.round((Date.now() - this._exerciseStartTime) / 1000)
      : 0;

    // 완료 효과음
    await this.audio.playCompleteSound();
    await this.audio.speak(AudioManager.MESSAGES.COMPLETE);

    // 완료 화면 표시
    this.dom.completeTotalReps.textContent = count;
    this.dom.completeDuration.textContent = this._formatDuration(duration);
    this.dom.completeScreen.classList.add('active');

    // TODO: 카카오톡 알림 웹훅 트리거 (3주차)
    console.log('[App] TODO: 카카오톡 알림 발송');
  }

  /**
   * FPS 업데이트 콜백
   * @private
   */
  _onFpsUpdate(fps) {
    if (this.dom.debugFps) {
      this.dom.debugFps.textContent = fps;
    }
  }

  // ============================
  // 타이머
  // ============================

  /**
   * 운동 타이머 시작
   * @private
   */
  _startTimer() {
    if (this.dom.exerciseTimer) {
      this.dom.exerciseTimer.classList.add('active');
    }

    this._timerInterval = setInterval(() => {
      if (!this._exerciseStartTime) return;
      const elapsed = Math.floor((Date.now() - this._exerciseStartTime) / 1000);
      const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const seconds = String(elapsed % 60).padStart(2, '0');

      if (this.dom.timerText) {
        this.dom.timerText.textContent = `${minutes}:${seconds}`;
      }
    }, 1000);
  }

  /**
   * 운동 타이머 중지
   * @private
   */
  _stopTimer() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }

  // ============================
  // 자녀 알림 (3주차 웹훅 대비)
  // ============================

  /**
   * 자녀에게 알림 전송 (3주차에 실제 웹훅 연동)
   * @private
   */
  async _sendNotification() {
    const btn = this.dom.notifyButton;
    if (!btn || btn.disabled) return;

    btn.disabled = true;
    btn.innerHTML = '📨 전송 중...';

    // TODO: 3주차에 Make(Integromat) 웹훅 URL로 실제 전송
    // const webhookUrl = 'https://hook.make.com/your-webhook-id';
    // await fetch(webhookUrl, { method: 'POST', body: JSON.stringify({ ... }) });

    // 시뮬레이션: 1.5초 후 전송 완료
    await this._delay(1500);

    btn.classList.add('sent');
    btn.innerHTML = '✅ 알림을 보냈습니다!';

    await this.audio.speak(AudioManager.MESSAGES.NOTIFY_SENT);

    console.log('[App] 자녀 알림 전송 완료 (시뮬레이션)');
  }

  // ============================
  // 에러 핸들링
  // ============================

  /**
   * 에러 화면 표시
   * @private
   */
  _showError(message) {
    if (this.dom.errorScreen) {
      this.dom.errorScreen.classList.add('active');
    }
    if (this.dom.errorMessage) {
      this.dom.errorMessage.textContent = message;
    }
    // 시작 화면 숨기기
    this.dom.startScreen.classList.add('hidden');
  }

  /**
   * 에러에서 재시도
   * @private
   */
  async _retryFromError() {
    if (this.dom.errorScreen) {
      this.dom.errorScreen.classList.remove('active');
    }

    // 시작 화면 다시 보이기
    this.dom.startScreen.classList.remove('hidden');

    // 재초기화 시도
    try {
      await this.detector.init();
      this._updateMessage('시작 버튼을 눌러주세요');
    } catch (error) {
      console.error('[App] 재초기화 실패:', error);
      this._showError('여전히 문제가 있습니다. 페이지를 새로고침해 주세요.');
    }
  }

  // ============================
  // UI 업데이트
  // ============================

  _updateCount(count) {
    this.dom.countNumber.textContent = count;
  }

  _updateProgress(ratio) {
    const percent = Math.min(Math.round(ratio * 100), 100);
    this.dom.progressFill.style.width = `${percent}%`;
    this.dom.progressText.textContent = `${this.counter.count} / ${this.config.targetCount}`;
  }

  _updateMessage(text) {
    this.dom.messageText.textContent = text;
  }

  _updateStatusDot(state) {
    const dot = this.dom.statusDot;
    dot.classList.remove('warning', 'error');

    switch (state) {
      case AppState.WAITING_POSE:
        dot.classList.add('warning');
        break;
      case AppState.EXERCISING:
        // 기본 녹색
        break;
      case AppState.COMPLETE:
        // 기본 녹색
        break;
      default:
        break;
    }
  }

  _updateStatusText(state) {
    const textMap = {
      [AppState.IDLE]:         '대기 중',
      [AppState.GREETING]:     '안내 중',
      [AppState.WAITING_POSE]: '위치 확인 중',
      [AppState.COUNTDOWN]:    '카운트다운',
      [AppState.EXERCISING]:   '운동 중',
      [AppState.COMPLETE]:     '완료!',
    };
    this.dom.statusText.textContent = textMap[state] || state;
  }

  _updateDebug(poseData) {
    if (!this.dom.debugPanel) return;

    if (this.dom.debugState) {
      this.dom.debugState.textContent = poseData.state;
    }
    if (this.dom.debugKneeL) {
      this.dom.debugKneeL.textContent = `${poseData.leftKneeAngle}°`;
    }
    if (this.dom.debugKneeR) {
      this.dom.debugKneeR.textContent = `${poseData.rightKneeAngle}°`;
    }
    if (this.dom.debugConfidence) {
      this.dom.debugConfidence.textContent = `${poseData.confidence}%`;
    }
  }

  // ============================
  // DOM 바인딩
  // ============================

  _bindDOM() {
    this.dom = {
      // 카메라
      video: document.getElementById('camera-video'),
      canvas: document.getElementById('pose-canvas'),

      // 시작 화면
      startScreen: document.getElementById('start-screen'),
      startButton: document.getElementById('start-button'),

      // 상태바
      statusDot: document.getElementById('status-dot'),
      statusText: document.getElementById('status-text'),

      // 운동 타이머
      exerciseTimer: document.getElementById('exercise-timer'),
      timerText: document.getElementById('timer-text'),

      // 운동 종류
      exerciseType: document.getElementById('exercise-type'),

      // 카운트
      countNumber: document.getElementById('count-number'),

      // 메시지
      messageDisplay: document.getElementById('message-display'),
      messageText: document.getElementById('message-text'),

      // 프로그레스
      progressFill: document.getElementById('progress-fill'),
      progressText: document.getElementById('progress-text'),

      // 카운트다운
      countdownOverlay: document.getElementById('countdown-overlay'),
      countdownNumber: document.getElementById('countdown-number'),

      // 완료 화면
      completeScreen: document.getElementById('complete-screen'),
      completeTotalReps: document.getElementById('complete-total-reps'),
      completeDuration: document.getElementById('complete-duration'),
      restartButton: document.getElementById('restart-button'),
      notifyButton: document.getElementById('notify-button'),

      // 에러 화면
      errorScreen: document.getElementById('error-screen'),
      errorMessage: document.getElementById('error-message'),
      errorRetryButton: document.getElementById('error-retry-button'),

      // 디버그
      debugPanel: document.getElementById('debug-panel'),
      debugFps: document.getElementById('debug-fps'),
      debugState: document.getElementById('debug-state'),
      debugKneeL: document.getElementById('debug-knee-l'),
      debugKneeR: document.getElementById('debug-knee-r'),
      debugConfidence: document.getElementById('debug-confidence'),
    };
  }

  // ============================
  // 유틸리티
  // ============================

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
  }
}

// ============================
// 앱 실행
// ============================
document.addEventListener('DOMContentLoaded', async () => {
  const app = new SilverStepApp();
  try {
    await app.init();
    console.log('[App] 실버스텝 MVP 준비 완료! 🚶‍♂️');
  } catch (error) {
    console.error('[App] 초기화 실패:', error);
    // 에러 시 사용자에게 안내
    const msg = document.getElementById('message-text');
    if (msg) {
      msg.textContent = '앱 로딩에 실패했습니다. 페이지를 새로고침해주세요.';
    }
  }
});
