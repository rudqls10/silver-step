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
    };

    // 포즈 유지 타이머
    this._poseHoldTimer = null;
    this._poseDetectedTime = null;

    // 운동 시작 시간 (통계용)
    this._exerciseStartTime = null;
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
    });

    // 포즈 감지기 초기화
    const video = this.dom.video;
    const canvas = this.dom.canvas;
    this.detector = new MediaPipePoseDetector(video, canvas, {
      drawSkeleton: true,
      blurBackground: false,
      onPoseState: (state) => this._onPoseState(state),
      onFpsUpdate: (fps) => this._onFpsUpdate(fps),
    });

    await this.detector.init();

    // 시작 버튼 이벤트
    this.dom.startButton.addEventListener('click', () => this.start());
    this.dom.restartButton.addEventListener('click', () => this.restart());

    // 초기 상태 설정
    this._setState(AppState.IDLE);
    this._updateMessage('시작 버튼을 눌러주세요');

    console.log('[App] 초기화 완료');
  }

  /**
   * 앱 시작 (시작 버튼 클릭 후)
   */
  async start() {
    // 카메라 시작
    await this.detector.start();
    this.detector.resizeCanvas();

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

    // UI 초기화
    this.dom.completeScreen.classList.remove('active');
    this.dom.countdownOverlay.classList.remove('active');
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
    await this.audio.speak(AudioManager.MESSAGES.START);
    this._updateMessage('운동을 시작하세요!');
  }

  /**
   * 운동 중 포즈 처리
   * @private
   */
  _handleExercising(poseData) {
    if (!poseData.detected) return;
    this.counter.update(poseData.state);
  }

  /**
   * 카운트 업데이트 콜백
   * @private
   */
  _onCountUpdate(count, target) {
    this._updateCount(count);
    this._updateProgress(count / target);

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
    this._updateMessage(`${count}번 성공! 조금만 더 힘내세요!`);
    await this.audio.speak(AudioManager.MESSAGES.ENCOURAGE);
  }

  /**
   * 운동 완료 콜백
   * @private
   */
  async _onComplete(count) {
    console.log(`[App] 운동 완료: ${count}회`);
    this._setState(AppState.COMPLETE);

    // 운동 시간 계산
    const duration = this._exerciseStartTime
      ? Math.round((Date.now() - this._exerciseStartTime) / 1000)
      : 0;

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

      // 카운트
      countNumber: document.getElementById('count-number'),

      // 메시지
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
