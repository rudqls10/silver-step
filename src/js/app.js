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
import { ExerciseType, getExerciseConfig } from './exercises.js';
import { WebhookManager } from './webhook.js';
import { ExerciseHistory } from './history.js';

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
    this.webhook = null;
    this.history = null;

    // 현재 선택된 운동
    this.currentExercise = ExerciseType.MANSE;
    this._exerciseConfig = getExerciseConfig(this.currentExercise);

    // DOM 요소
    this.dom = {};

    // 웹훅 매니저 초기화 (설정 로드)
    this.webhook = new WebhookManager();

    // 운동 이력 매니저 초기화
    this.history = new ExerciseHistory();

    // 설정 (웹훅 매니저에서 목표 횟수 로드)
    this.config = {
      targetCount: this.webhook.targetCount,
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

    // 네트워크 상태
    this._isOnline = navigator.onLine;

    // 현재 운동 기록 ID (알림 상태 업데이트용)
    this._currentRecordId = null;

    // 안전 타이머 (10분)
    this._safetyTimerTimeout = null;
    this._safetyTimerFired = false;
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

    // ★ 이벤트를 먼저 바인딩 (MediaPipe 실패해도 버튼 동작하도록)
    this._bindExerciseCards();
    this.dom.startButton.addEventListener('click', () => this.start());
    this.dom.restartButton.addEventListener('click', () => this.restart());
    if (this.dom.notifyButton) {
      this.dom.notifyButton.addEventListener('click', () => this._sendNotification());
    }
    if (this.dom.errorRetryButton) {
      this.dom.errorRetryButton.addEventListener('click', () => this._retryFromError());
    }

    // 설정 모달 이벤트 바인딩
    this._bindSettingsModal();

    // 목표 횟수 UI 초기 반영
    this._applyTargetCount(this.config.targetCount);

    // 네트워크 상태 감지 초기화
    this._initNetworkDetection();

    // SOS 버튼 이벤트 바인딩
    this._bindSOS();

    // 초기 상태 설정
    this._setState(AppState.IDLE);

    // 포즈 감지기 초기화
    const video = this.dom.video;
    const canvas = this.dom.canvas;
    this.detector = new MediaPipePoseDetector(video, canvas, {
      drawSkeleton: true,
      blurBackground: false,
      onPoseState: (state) => this._onPoseState(state),
      onFpsUpdate: (fps) => this._onFpsUpdate(fps),
    });

    // MediaPipe 모델 로딩 (모바일에서 시간이 걸릴 수 있음)
    this._updateMessage('AI 모델을 불러오는 중... 잠시만 기다려 주세요 🙏');
    try {
      await this.detector.init();
      this._mediaPipeReady = true;
      this._updateMessage('운동을 선택하고 시작 버튼을 눌러주세요');
      console.log('[App] 초기화 완료');

      // 자동 시작 모드 체크
      if (this.webhook.autoStart) {
        console.log('[App] 자동 시작 모드 활성화 — 자동으로 운동 시작');
        this.dom.startScreen.classList.add('auto-start-skip');
        setTimeout(() => this.start(), 1000);
      }
    } catch (error) {
      console.error('[App] MediaPipe 초기화 실패:', error);
      this._mediaPipeReady = false;
      this._updateMessage('AI 모델 로딩에 실패했습니다. 시작 버튼을 다시 눌러주세요.');
    }
  }

  /**
   * 앱 시작 (시작 버튼 클릭 후)
   */
  async start() {
    // MediaPipe가 아직 준비 안 됐으면 재시도
    if (!this._mediaPipeReady) {
      this._updateMessage('AI 모델을 불러오는 중... 잠시만 기다려 주세요 🙏');
      try {
        await this.detector.init();
        this._mediaPipeReady = true;
      } catch (error) {
        console.error('[App] MediaPipe 재초기화 실패:', error);
        this._showError('AI 모델을 불러올 수 없습니다. 인터넷 연결을 확인하고 페이지를 새로고침해 주세요.');
        return;
      }
    }

    try {
      // 선택된 운동 타입을 감지기에 설정
      this.detector.setExerciseType(this.currentExercise);

      // 카메라 시작
      this._updateMessage('카메라를 연결하는 중...');
      await this.detector.start();
      this.detector.resizeCanvas();
    } catch (error) {
      console.error('[App] 카메라 시작 실패:', error);
      this._showError('카메라를 사용할 수 없습니다. 카메라 권한을 확인해 주세요.');
      return;
    }

    // 시작 화면 숨기기
    this.dom.startScreen.classList.add('hidden');
    // 설정 버튼 숨기기 (fixed이므로 별도 처리)
    if (this.dom.settingsButton) {
      this.dom.settingsButton.style.display = 'none';
    }

    // 인사 상태로 전환
    this._setState(AppState.GREETING);
    await this.audio.speak(AudioManager.MESSAGES.GREETING);

    // 인사 완료 → 포즈 대기
    this._setState(AppState.WAITING_POSE);
    this._updateMessage(this._exerciseConfig.waitingMessage || '초록색 위치에 서 주세요');

    // SOS 버튼 표시
    this._showSOS(true);
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
      this.dom.notifyButton.classList.remove('sent', 'failed', 'sending');
      this.dom.notifyButton.disabled = false;
      const content = this.dom.notifyButton.querySelector('.notify-btn-content');
      if (content) {
        content.querySelector('.notify-icon').textContent = '📱';
        content.querySelector('.notify-label').textContent = '자녀에게 알림 보내기';
      }
    }
    if (this.dom.notifyStatus) {
      this.dom.notifyStatus.textContent = '';
      this.dom.notifyStatus.className = 'notify-status';
    }

    this._updateCount(0);
    this._updateProgress(0);

    // SOS 버튼 표시
    this._showSOS(true);

    // 다시 인사부터
    this._setState(AppState.GREETING);
    await this.audio.speak(AudioManager.MESSAGES.GREETING);
    this._setState(AppState.WAITING_POSE);
    this._updateMessage(this._exerciseConfig.waitingMessage || '초록색 위치에 서 주세요');
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
    // 운동별 대기 포즈 확인 (만세=UP으로 시작, 무릎올리기=DOWN으로 시작)
    const expectedPose = this._exerciseConfig.waitingPose || 'UP';

    if (poseData.detected && poseData.state === expectedPose) {
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
        this._updateMessage(this._exerciseConfig.waitingMessage || '올바른 자세를 취해주세요');
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
      this.dom.exerciseType.textContent = `${this._exerciseConfig.icon} ${this._exerciseConfig.name}`;
      this.dom.exerciseType.classList.add('active');
    }

    // 타이머 시작
    this._startTimer();

    // 안전 타이머 시작 (10분)
    this._startSafetyTimer();

    // 운동별 시작 안내
    if (this.currentExercise === ExerciseType.KNEE_RAISE) {
      await this.audio.speak(AudioManager.MESSAGES.KNEE_RAISE_START);
    } else {
      await this.audio.speak(AudioManager.MESSAGES.START);
    }
    this._updateMessage(`${this._exerciseConfig.description}`);
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

    // 안전 타이머 중지
    this._stopSafetyTimer();

    // SOS 버튼 숨기기
    this._showSOS(false);

    // 운동 시간 계산
    const duration = this._exerciseStartTime
      ? Math.round((Date.now() - this._exerciseStartTime) / 1000)
      : 0;

    // 운동 결과 데이터 저장 (알림 전송 시 사용)
    this._lastExerciseData = {
      exerciseName: this._exerciseConfig.name,
      exerciseIcon: this._exerciseConfig.icon,
      totalReps: count,
      durationSeconds: duration,
    };

    // 운동 이력 저장
    const record = this.history.addRecord({
      exerciseName: this._exerciseConfig.name,
      exerciseIcon: this._exerciseConfig.icon,
      totalReps: count,
      targetReps: this.config.targetCount,
      durationSeconds: duration,
      notificationSent: false,
    });
    this._currentRecordId = record.id;

    // 완료 효과음
    await this.audio.playCompleteSound();
    await this.audio.speak(AudioManager.MESSAGES.COMPLETE);

    // 완료 화면 표시
    this.dom.completeTotalReps.textContent = count;
    this.dom.completeDuration.textContent = this._formatDuration(duration);
    this.dom.completeScreen.classList.add('active');

    // 오늘의 운동 요약 업데이트
    this._updateTodaySummary();

    // 자동 알림 전송 (설정된 경우)
    if (this.webhook.autoNotify) {
      console.log('[App] 자동 알림 전송 실행');
      // 살짝 딜레이 후 자동 전송 (UI가 보이고 나서)
      setTimeout(() => this._sendNotification(), 800);
    }
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
  // 자녀 알림 (Make 웹훅 연동)
  // ============================

  /**
   * 자녀에게 알림 전송 (Make 웹훅 또는 시뮬레이션)
   * @private
   */
  async _sendNotification() {
    const btn = this.dom.notifyButton;
    const statusEl = this.dom.notifyStatus;
    if (!btn || btn.disabled) return;

    // 오프라인 체크
    if (!this._isOnline) {
      if (statusEl) {
        statusEl.textContent = '❌ 인터넷 연결을 확인해주세요';
        statusEl.className = 'notify-status error';
      }
      return;
    }

    // 전송 중 상태
    btn.disabled = true;
    btn.classList.remove('sent', 'failed');
    btn.classList.add('sending');
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.className = 'notify-status';
    }

    try {
      // 운동 결과 데이터가 없으면 기본값
      const exerciseData = this._lastExerciseData || {
        exerciseName: this._exerciseConfig.name,
        exerciseIcon: this._exerciseConfig.icon,
        totalReps: this.counter.count,
        durationSeconds: 0,
      };

      // 웹훅 전송 (실제 또는 시뮬레이션)
      const result = await this.webhook.sendExerciseComplete(exerciseData);

      btn.classList.remove('sending');

      if (result.success) {
        btn.classList.add('sent');
        const content = btn.querySelector('.notify-btn-content');
        if (content) {
          content.querySelector('.notify-icon').textContent = '✅';
          content.querySelector('.notify-label').textContent = '알림을 보냈습니다!';
        }

        if (statusEl) {
          if (result.simulated) {
            statusEl.textContent = '⚠️ 시뮬레이션 모드 (설정에서 웹훅 URL을 입력하세요)';
            statusEl.className = 'notify-status simulated';
          } else {
            statusEl.textContent = '✅ 카카오톡 알림이 전송되었습니다';
            statusEl.className = 'notify-status success';
          }
        }

        await this.audio.speak(AudioManager.MESSAGES.NOTIFY_SENT);
        console.log('[App] 자녀 알림 전송 완료:', result.message);

        // 운동 이력에 알림 상태 업데이트
        if (this._currentRecordId) {
          this.history.updateNotificationStatus(this._currentRecordId, true);
        }
      } else {
        // 전송 실패
        btn.classList.add('failed');
        btn.disabled = false; // 재시도 가능
        const content = btn.querySelector('.notify-btn-content');
        if (content) {
          content.querySelector('.notify-icon').textContent = '⚠️';
          content.querySelector('.notify-label').textContent = '전송 실패 - 다시 시도';
        }

        if (statusEl) {
          statusEl.textContent = `❌ ${result.message}`;
          statusEl.className = 'notify-status error';
        }

        console.warn('[App] 자녀 알림 전송 실패:', result.message);
      }
    } catch (error) {
      btn.classList.remove('sending');
      btn.classList.add('failed');
      btn.disabled = false;
      const content = btn.querySelector('.notify-btn-content');
      if (content) {
        content.querySelector('.notify-icon').textContent = '⚠️';
        content.querySelector('.notify-label').textContent = '전송 실패 - 다시 시도';
      }

      if (statusEl) {
        statusEl.textContent = '❌ 네트워크 오류가 발생했습니다';
        statusEl.className = 'notify-status error';
      }

      console.error('[App] 알림 전송 에러:', error);
    }
  }

  // ============================
  // SOS 긴급 중단 (4주차)
  // ============================

  /**
   * SOS 버튼 이벤트 바인딩
   * @private
   */
  _bindSOS() {
    const sosBtn = document.getElementById('sos-button');
    const confirmOverlay = document.getElementById('sos-confirm-overlay');
    const stopBtn = document.getElementById('sos-btn-stop');
    const resumeBtn = document.getElementById('sos-btn-resume');

    if (sosBtn) {
      sosBtn.addEventListener('click', () => {
        // SOS 확인 모달 표시
        if (confirmOverlay) confirmOverlay.classList.add('active');
        // 음성 안내
        this.audio.speak(AudioManager.MESSAGES.SOS_CONFIRM);
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', async () => {
        // 모달 닫기
        if (confirmOverlay) confirmOverlay.classList.remove('active');

        // 운동 중단 → 완료 화면으로
        this._stopTimer();
        this._stopSafetyTimer();
        this._showSOS(false);

        const count = this.counter.count;
        const duration = this._exerciseStartTime
          ? Math.round((Date.now() - this._exerciseStartTime) / 1000)
          : 0;

        // 이력 저장 (중단 마크)
        this.history.addRecord({
          exerciseName: this._exerciseConfig.name + ' (중단)',
          exerciseIcon: '🆘',
          totalReps: count,
          targetReps: this.config.targetCount,
          durationSeconds: duration,
          notificationSent: false,
        });

        // SOS 알림 전송 (설정된 경우)
        this.webhook.sendSOSAlert();

        this._setState(AppState.COMPLETE);

        // 완료 화면 표시
        this.dom.completeTotalReps.textContent = count;
        this.dom.completeDuration.textContent = this._formatDuration(duration);
        this.dom.completeScreen.classList.add('active');
        this._updateTodaySummary();

        console.log('[App] SOS 운동 중단');
      });
    }

    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => {
        // 모달 닫고 계속
        if (confirmOverlay) confirmOverlay.classList.remove('active');
        this.audio.speak(AudioManager.MESSAGES.SOS_RESUMED);
        console.log('[App] SOS 취소 — 운동 계속');
      });
    }
  }

  /**
   * SOS 버튼 표시/숨김
   * @private
   */
  _showSOS(visible) {
    const btn = document.getElementById('sos-button');
    if (btn) {
      if (visible) {
        btn.classList.add('visible');
      } else {
        btn.classList.remove('visible');
      }
    }
  }

  // ============================
  // 안전 타이머 (10분 경고)
  // ============================

  /**
   * 10분 안전 타이머 시작
   * @private
   */
  _startSafetyTimer() {
    this._safetyTimerFired = false;
    this._stopSafetyTimer();

    this._safetyTimerTimeout = setTimeout(() => {
      this._safetyTimerFired = true;
      console.log('[App] 안전 타이머 발동 (10분)');

      // 경고 배너 표시
      const warning = document.getElementById('safety-warning');
      if (warning) {
        warning.classList.add('active');
        setTimeout(() => warning.classList.remove('active'), 8000);
      }

      // 음성 경고
      this.audio.speak(AudioManager.MESSAGES.SAFETY_TIMER);
    }, 10 * 60 * 1000); // 10분
  }

  /**
   * 안전 타이머 중지
   * @private
   */
  _stopSafetyTimer() {
    if (this._safetyTimerTimeout) {
      clearTimeout(this._safetyTimerTimeout);
      this._safetyTimerTimeout = null;
    }
    const warning = document.getElementById('safety-warning');
    if (warning) warning.classList.remove('active');
  }

  // ============================
  // 설정 모달
  // ============================

  /**
   * 설정 모달 이벤트 바인딩
   * @private
   */
  _bindSettingsModal() {
    // 설정 버튼 (열기)
    if (this.dom.settingsButton) {
      this.dom.settingsButton.addEventListener('click', () => this._openSettings());
    }

    // 닫기 버튼
    if (this.dom.settingsClose) {
      this.dom.settingsClose.addEventListener('click', () => this._closeSettings());
    }

    // 오버레이 클릭으로 닫기
    if (this.dom.settingsOverlay) {
      this.dom.settingsOverlay.addEventListener('click', (e) => {
        if (e.target === this.dom.settingsOverlay) {
          this._closeSettings();
        }
      });
    }

    // 저장 버튼
    if (this.dom.settingsSaveButton) {
      this.dom.settingsSaveButton.addEventListener('click', () => this._saveSettings());
    }

    // 테스트 알림 버튼
    if (this.dom.settingsTestButton) {
      this.dom.settingsTestButton.addEventListener('click', () => this._sendTestNotification());
    }
  }

  /**
   * 설정 모달 열기
   * @private
   */
  _openSettings() {
    // 현재 설정값을 입력 필드에 반영
    const settings = this.webhook.getSettings();

    if (this.dom.settingWebhookUrl) {
      this.dom.settingWebhookUrl.value = settings.webhookUrl;
    }
    if (this.dom.settingSeniorName) {
      this.dom.settingSeniorName.value = settings.seniorName === '어르신' ? '' : settings.seniorName;
    }
    if (this.dom.settingChildName) {
      this.dom.settingChildName.value = settings.childName === '자녀' ? '' : settings.childName;
    }
    if (this.dom.settingTargetCount) {
      this.dom.settingTargetCount.value = String(settings.targetCount);
    }
    if (this.dom.settingAutoNotify) {
      this.dom.settingAutoNotify.checked = settings.autoNotify;
    }
    if (this.dom.settingAutoStart) {
      this.dom.settingAutoStart.checked = settings.autoStart;
    }

    // 테스트 결과 초기화
    if (this.dom.settingsTestResult) {
      this.dom.settingsTestResult.textContent = '';
      this.dom.settingsTestResult.className = 'settings-test-result';
    }

    // 모달 표시
    this.dom.settingsOverlay.classList.add('active');
  }

  /**
   * 설정 모달 닫기
   * @private
   */
  _closeSettings() {
    this.dom.settingsOverlay.classList.remove('active');
  }

  /**
   * 설정 저장
   * @private
   */
  _saveSettings() {
    const newSettings = {
      webhookUrl: this.dom.settingWebhookUrl?.value || '',
      seniorName: this.dom.settingSeniorName?.value || '',
      childName: this.dom.settingChildName?.value || '',
      targetCount: this.dom.settingTargetCount?.value || '10',
      autoNotify: this.dom.settingAutoNotify?.checked || false,
      autoStart: this.dom.settingAutoStart?.checked || false,
    };

    this.webhook.saveSettings(newSettings);

    // 목표 횟수 업데이트
    const newTargetCount = parseInt(newSettings.targetCount, 10) || 10;
    this._applyTargetCount(newTargetCount);

    // 모달 닫기
    this._closeSettings();

    // 저장 확인 메시지
    this._updateMessage('✅ 설정이 저장되었습니다');
    console.log('[App] 설정 저장 완료');
  }

  /**
   * 목표 횟수 적용
   * @private
   */
  _applyTargetCount(targetCount) {
    this.config.targetCount = targetCount;

    // 마일스톤 재계산 (절반 지점)
    const milestone = Math.round(targetCount / 2);
    this.config.milestones = milestone > 0 && milestone < targetCount ? [milestone] : [];

    // 카운터 업데이트
    if (this.counter) {
      this.counter.targetCount = targetCount;
      this.counter.milestones = this.config.milestones;
    }

    // UI 업데이트
    if (this.dom.countTarget) {
      this.dom.countTarget.textContent = `/ ${targetCount}`;
    }
    if (this.dom.progressText) {
      this.dom.progressText.textContent = `0 / ${targetCount}`;
    }
  }

  /**
   * 테스트 알림 전송
   * @private
   */
  async _sendTestNotification() {
    const resultEl = this.dom.settingsTestResult;
    if (!resultEl) return;

    // 먼저 현재 입력값을 임시 저장
    const tempUrl = this.dom.settingWebhookUrl?.value || '';
    this.webhook.saveSettings({ webhookUrl: tempUrl });

    resultEl.textContent = '전송 중...';
    resultEl.className = 'settings-test-result info';

    const result = await this.webhook.sendTestNotification();

    if (result.success) {
      resultEl.textContent = `✅ ${result.message}`;
      resultEl.className = 'settings-test-result success';
    } else {
      resultEl.textContent = `❌ ${result.message}`;
      resultEl.className = 'settings-test-result error';
    }
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

      // 운동 선택
      exerciseSelector: document.getElementById('exercise-selector'),
      exerciseCards: document.querySelectorAll('.exercise-card'),

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
      countTarget: document.getElementById('count-target'),

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
      notifyStatus: document.getElementById('notify-status'),

      // 에러 화면
      errorScreen: document.getElementById('error-screen'),
      errorMessage: document.getElementById('error-message'),
      errorRetryButton: document.getElementById('error-retry-button'),

      // 설정 모달
      settingsButton: document.getElementById('settings-button'),
      settingsOverlay: document.getElementById('settings-modal-overlay'),
      settingsClose: document.getElementById('settings-close'),
      settingsSaveButton: document.getElementById('settings-save-button'),
      settingsTestButton: document.getElementById('settings-test-button'),
      settingsTestResult: document.getElementById('settings-test-result'),
      settingWebhookUrl: document.getElementById('setting-webhook-url'),
      settingSeniorName: document.getElementById('setting-senior-name'),
      settingChildName: document.getElementById('setting-child-name'),
      settingTargetCount: document.getElementById('setting-target-count'),
      settingAutoNotify: document.getElementById('setting-auto-notify'),
      settingAutoStart: document.getElementById('setting-auto-start'),

      // 오프라인 배너
      offlineBanner: document.getElementById('offline-banner'),

      // 오늘의 운동 요약 (완료 화면)
      todaySummary: document.getElementById('today-summary'),
      todaySessions: document.getElementById('today-sessions'),
      todayTotalReps: document.getElementById('today-total-reps'),
      todayTotalTime: document.getElementById('today-total-time'),

      // 디버그
      debugPanel: document.getElementById('debug-panel'),
      debugFps: document.getElementById('debug-fps'),
      debugState: document.getElementById('debug-state'),
      debugKneeL: document.getElementById('debug-knee-l'),
      debugKneeR: document.getElementById('debug-knee-r'),
      debugConfidence: document.getElementById('debug-confidence'),
    };
  }

  /**
   * 운동 선택 카드 이벤트 바인딩
   * @private
   */
  _bindExerciseCards() {
    this.dom.exerciseCards.forEach(card => {
      card.addEventListener('click', () => {
        const exerciseType = card.dataset.exercise;
        if (!exerciseType) return;

        // 선택 상태 업데이트
        this.dom.exerciseCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');

        // 운동 타입 설정
        this.currentExercise = exerciseType;
        this._exerciseConfig = getExerciseConfig(exerciseType);

        console.log(`[App] 운동 선택: ${this._exerciseConfig.name}`);
      });
    });
  }

  // ============================
  // 네트워크 상태 감지
  // ============================

  /**
   * 네트워크 온/오프라인 감지 초기화
   * @private
   */
  _initNetworkDetection() {
    this._isOnline = navigator.onLine;
    this._updateOfflineBanner();

    window.addEventListener('online', () => {
      this._isOnline = true;
      this._updateOfflineBanner();
      console.log('[App] 네트워크 연결됨');
    });

    window.addEventListener('offline', () => {
      this._isOnline = false;
      this._updateOfflineBanner();
      console.log('[App] 네트워크 끊김');
    });
  }

  /**
   * 오프라인 배너 표시/숨김
   * @private
   */
  _updateOfflineBanner() {
    if (this.dom.offlineBanner) {
      if (this._isOnline) {
        this.dom.offlineBanner.classList.remove('active');
      } else {
        this.dom.offlineBanner.classList.add('active');
      }
    }
  }

  // ============================
  // 오늘의 운동 요약
  // ============================

  /**
   * 완료 화면에 오늘 운동 요약 업데이트
   * @private
   */
  _updateTodaySummary() {
    const summary = this.history.getTodaySummary();
    if (this.dom.todaySessions) {
      this.dom.todaySessions.textContent = summary.totalSessions;
    }
    if (this.dom.todayTotalReps) {
      this.dom.todayTotalReps.textContent = summary.totalReps;
    }
    if (this.dom.todayTotalTime) {
      this.dom.todayTotalTime.textContent = ExerciseHistory.formatDuration(summary.totalDuration);
    }
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
