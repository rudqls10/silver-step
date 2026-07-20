/**
 * WebhookManager - Make(Integromat) 웹훅 연동 모듈
 *
 * 운동 완료 시 Make 웹훅을 호출하여 카카오톡 알림톡을 트리거합니다.
 * 웹훅 URL이 설정되지 않으면 시뮬레이션 모드로 동작합니다.
 *
 * 설정값은 localStorage에 저장되며, 설정 모달에서 관리합니다.
 *
 * 사용법:
 *   const webhook = new WebhookManager();
 *   const result = await webhook.sendExerciseComplete({ ... });
 */
export class WebhookManager {
  constructor() {
    // localStorage 키
    this.STORAGE_KEYS = {
      WEBHOOK_URL:   'silverstep_webhook_url',
      SENIOR_NAME:   'silverstep_senior_name',
      CHILD_NAME:    'silverstep_child_name',
      TARGET_COUNT:  'silverstep_target_count',
      AUTO_NOTIFY:   'silverstep_auto_notify',
      SEND_LOG:      'silverstep_webhook_log',
      AUTO_START:    'silverstep_auto_start',
    };

    // 재시도 설정
    this.maxRetries = 2;
    this.retryDelayMs = 1500;

    // 전송 로그 최대 보관 수
    this.MAX_LOG_ENTRIES = 10;

    // 설정 로드
    this._loadSettings();
  }

  // ============================
  // 설정 관리
  // ============================

  /**
   * localStorage에서 설정 로드
   * @private
   */
  _loadSettings() {
    this.webhookUrl  = localStorage.getItem(this.STORAGE_KEYS.WEBHOOK_URL) || '';
    this.seniorName  = localStorage.getItem(this.STORAGE_KEYS.SENIOR_NAME) || '어르신';
    this.childName   = localStorage.getItem(this.STORAGE_KEYS.CHILD_NAME) || '자녀';
    this.targetCount = parseInt(localStorage.getItem(this.STORAGE_KEYS.TARGET_COUNT), 10) || 10;
    this.autoNotify  = localStorage.getItem(this.STORAGE_KEYS.AUTO_NOTIFY) === 'true';
    this.autoStart   = localStorage.getItem(this.STORAGE_KEYS.AUTO_START) === 'true';
  }

  /**
   * 설정 저장
   * @param {Object} settings - { webhookUrl, seniorName, childName, targetCount }
   */
  saveSettings(settings) {
    if (settings.webhookUrl !== undefined) {
      this.webhookUrl = settings.webhookUrl.trim();
      localStorage.setItem(this.STORAGE_KEYS.WEBHOOK_URL, this.webhookUrl);
    }
    if (settings.seniorName !== undefined) {
      this.seniorName = settings.seniorName.trim() || '어르신';
      localStorage.setItem(this.STORAGE_KEYS.SENIOR_NAME, this.seniorName);
    }
    if (settings.childName !== undefined) {
      this.childName = settings.childName.trim() || '자녀';
      localStorage.setItem(this.STORAGE_KEYS.CHILD_NAME, this.childName);
    }
    if (settings.targetCount !== undefined) {
      this.targetCount = parseInt(settings.targetCount, 10) || 10;
      localStorage.setItem(this.STORAGE_KEYS.TARGET_COUNT, String(this.targetCount));
    }
    if (settings.autoNotify !== undefined) {
      this.autoNotify = !!settings.autoNotify;
      localStorage.setItem(this.STORAGE_KEYS.AUTO_NOTIFY, String(this.autoNotify));
    }
    if (settings.autoStart !== undefined) {
      this.autoStart = !!settings.autoStart;
      localStorage.setItem(this.STORAGE_KEYS.AUTO_START, String(this.autoStart));
    }

    console.log('[Webhook] 설정 저장:', {
      webhookUrl: this.webhookUrl ? '설정됨' : '미설정',
      seniorName: this.seniorName,
      childName: this.childName,
      targetCount: this.targetCount,
      autoNotify: this.autoNotify,
    });
  }

  /**
   * 현재 설정 가져오기
   * @returns {Object}
   */
  getSettings() {
    return {
      webhookUrl:  this.webhookUrl,
      seniorName:  this.seniorName,
      childName:   this.childName,
      targetCount: this.targetCount,
      autoNotify:  this.autoNotify,
      autoStart:   this.autoStart,
    };
  }

  /**
   * 웹훅이 설정되어 있는지 확인
   * Make 웹훅 URL 형식: https://hook.make.com/... 또는 https://hook.eu1.make.com/... 등
   * @returns {boolean}
   */
  get isConfigured() {
    return this.webhookUrl.length > 0 && this._isValidWebhookUrl(this.webhookUrl);
  }

  /**
   * 웹훅 URL 유효성 검증
   * Make 웹훅 URL 형식 및 일반 HTTPS URL 허용
   * @param {string} url
   * @returns {boolean}
   */
  _isValidWebhookUrl(url) {
    try {
      const parsed = new URL(url);
      // HTTPS 필수 (개발용 HTTP localhost는 예외 허용)
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // ============================
  // 웹훅 전송
  // ============================

  /**
   * 운동 완료 알림 전송
   * @param {Object} exerciseData - 운동 결과 데이터
   * @param {string} exerciseData.exerciseName - 운동 이름 (예: '만세 운동')
   * @param {string} exerciseData.exerciseIcon - 운동 아이콘 (예: '🙌')
   * @param {number} exerciseData.totalReps - 총 횟수
   * @param {number} exerciseData.durationSeconds - 소요 시간 (초)
   * @returns {Promise<WebhookResult>}
   */
  async sendExerciseComplete(exerciseData) {
    const payload = this._buildPayload(exerciseData);

    // 시뮬레이션 모드
    if (!this.isConfigured) {
      console.log('[Webhook] 시뮬레이션 모드 - 웹훅 URL 미설정');
      console.log('[Webhook] 전송할 페이로드:', JSON.stringify(payload, null, 2));
      // 시뮬레이션 딜레이
      await this._delay(1200);
      const result = {
        success: true,
        simulated: true,
        message: '시뮬레이션 모드: 설정에서 Make 웹훅 URL을 입력하면 실제 알림이 전송됩니다.',
        payload,
      };
      this._saveLog(result);
      return result;
    }

    // 실제 전송 (재시도 포함)
    const result = await this._sendWithRetry(payload);
    this._saveLog(result);
    return result;
  }

  /**
   * SOS 알림 전송 (긴급 운동 중단 시)
   * @returns {Promise<WebhookResult>}
   */
  async sendSOSAlert() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: true });
    const dateString = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

    const sosPayload = {
      seniorName:   this.seniorName,
      childName:    this.childName,
      isSOS:        true,
      date:         dateString,
      time:         timeString,
      timestamp:    now.toISOString(),
      message: `[실버스텝 🆘] ${this.seniorName}님이 운동 중 쉬어가기 버튼을 눌렀습니다.\n\n📅 ${dateString} ${timeString}\n\n걱정하지 마세요. 잠시 쉬고 있을 뿐입니다. 안부 전화를 드려보세요. 📞`,
    };

    if (!this.isConfigured) {
      console.log('[Webhook] SOS 시뮬레이션:', JSON.stringify(sosPayload, null, 2));
      await this._delay(500);
      return { success: true, simulated: true, message: 'SOS 시뮬레이션', payload: sosPayload };
    }

    return await this._sendWithRetry(sosPayload);
  }

  /**
   * 테스트 알림 전송 (설정 모달에서 사용)
   * @returns {Promise<WebhookResult>}
   */
  async sendTestNotification() {
    const testPayload = this._buildPayload({
      exerciseName: '테스트',
      exerciseIcon: '🧪',
      totalReps: 0,
      durationSeconds: 0,
    });
    testPayload.isTest = true;

    if (!this.isConfigured) {
      return {
        success: false,
        simulated: false,
        message: '웹훅 URL을 먼저 입력해주세요.',
        payload: testPayload,
      };
    }

    return await this._sendWithRetry(testPayload);
  }

  // ============================
  // 내부 메서드
  // ============================

  /**
   * Make 웹훅용 페이로드 구성
   * @private
   */
  _buildPayload(exerciseData) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const dateString = now.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // 운동 시간 포맷
    const durationMin = Math.floor((exerciseData.durationSeconds || 0) / 60);
    const durationSec = (exerciseData.durationSeconds || 0) % 60;
    const durationText = durationMin > 0
      ? `${durationMin}분 ${durationSec}초`
      : `${durationSec}초`;

    return {
      // Make 시나리오에서 사용할 필드들
      seniorName:    this.seniorName,
      childName:     this.childName,
      exerciseName:  exerciseData.exerciseName || '운동',
      exerciseIcon:  exerciseData.exerciseIcon || '🏃',
      totalReps:     exerciseData.totalReps || 0,
      duration:      durationText,
      date:          dateString,
      time:          timeString,
      timestamp:     now.toISOString(),

      // 알림톡 메시지 템플릿에 사용할 전체 메시지
      message: `[실버스텝] ${this.seniorName}님이 ${exerciseData.exerciseIcon || '🏃'} ${exerciseData.exerciseName || '운동'}을 완료했습니다!\n\n📊 횟수: ${exerciseData.totalReps || 0}회\n⏱️ 시간: ${durationText}\n📅 ${dateString} ${timeString}\n\n오늘도 건강하게 운동을 마쳤습니다. 안심하세요! 💪`,
    };
  }

  /**
   * 재시도 로직이 포함된 웹훅 전송
   * @private
   */
  async _sendWithRetry(payload) {
    let lastError = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[Webhook] 재시도 ${attempt}/${this.maxRetries}...`);
          await this._delay(this.retryDelayMs);
        }

        const result = await this._send(payload);
        return result;
      } catch (error) {
        lastError = error;
        console.warn(`[Webhook] 전송 실패 (시도 ${attempt + 1}):`, error.message);
      }
    }

    // 모든 재시도 실패
    return {
      success: false,
      simulated: false,
      message: `알림 전송에 실패했습니다: ${lastError?.message || '알 수 없는 오류'}`,
      payload,
    };
  }

  /**
   * 실제 HTTP 요청 전송
   * @private
   */
  async _send(payload) {
    console.log('[Webhook] 전송 시작:', this.webhookUrl);

    // Make 웹훅은 일반적으로 CORS를 지원하지만,
    // 지원하지 않는 경우를 대비한 fallback 처리
    try {
      // 1차 시도: 일반 fetch (CORS 지원 시)
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      console.log('[Webhook] 응답 상태:', response.status);

      if (response.ok || response.status === 200) {
        return {
          success: true,
          simulated: false,
          message: '알림이 성공적으로 전송되었습니다!',
          payload,
          status: response.status,
        };
      }

      // Make는 "Accepted" 응답도 성공으로 처리
      if (response.status === 202) {
        return {
          success: true,
          simulated: false,
          message: '알림 전송이 접수되었습니다.',
          payload,
          status: response.status,
        };
      }

      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (fetchError) {
      // CORS 에러인 경우 no-cors 모드로 재시도
      if (fetchError.name === 'TypeError' && fetchError.message.includes('Failed to fetch')) {
        console.log('[Webhook] CORS 에러 감지, no-cors 모드로 재시도...');

        await fetch(this.webhookUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: {
            'Content-Type': 'text/plain',  // no-cors에서는 simple header만 가능
          },
          body: JSON.stringify(payload),
        });

        // no-cors 모드에서는 응답을 읽을 수 없으므로 성공으로 간주
        return {
          success: true,
          simulated: false,
          message: '알림이 전송되었습니다. (응답 확인 불가)',
          payload,
          status: 0,
        };
      }

      throw fetchError;
    }
  }

  /**
   * 유틸리티: 지연
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================
  // 전송 로그 관리
  // ============================

  /**
   * 전송 결과를 로그에 저장 (최근 10건)
   * @param {WebhookResult} result
   */
  _saveLog(result) {
    try {
      const logs = this.getSendLogs();
      logs.unshift({
        timestamp: new Date().toISOString(),
        success: result.success,
        simulated: result.simulated,
        message: result.message,
        exerciseName: result.payload?.exerciseName || '',
        totalReps: result.payload?.totalReps || 0,
        status: result.status || 0,
      });

      // 최대 개수 유지
      while (logs.length > this.MAX_LOG_ENTRIES) {
        logs.pop();
      }

      localStorage.setItem(this.STORAGE_KEYS.SEND_LOG, JSON.stringify(logs));
    } catch (e) {
      console.warn('[Webhook] 로그 저장 실패:', e);
    }
  }

  /**
   * 전송 로그 조회
   * @returns {Array} 최근 전송 로그 배열
   */
  getSendLogs() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEYS.SEND_LOG);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  /**
   * 전송 로그 초기화
   */
  clearSendLogs() {
    localStorage.removeItem(this.STORAGE_KEYS.SEND_LOG);
  }
}

/**
 * @typedef {Object} WebhookResult
 * @property {boolean} success - 전송 성공 여부
 * @property {boolean} simulated - 시뮬레이션 모드 여부
 * @property {string} message - 결과 메시지
 * @property {Object} payload - 전송된 페이로드
 * @property {number} [status] - HTTP 상태 코드
 */
