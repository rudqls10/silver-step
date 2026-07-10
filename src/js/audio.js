/**
 * AudioManager - 음성 재생 관리 모듈
 * Web Speech API(TTS)를 사용하여 한국어 음성 안내를 제공합니다.
 * 추후 성우 mp3 파일로 교체 가능한 인터페이스입니다.
 *
 * 사용법:
 *   const audio = new AudioManager();
 *   await audio.speak(AudioManager.MESSAGES.GREETING);
 */
export class AudioManager {
  constructor() {
    this.synth = window.speechSynthesis;
    this.isSpeaking = false;
    this.koreanVoice = null;
    this.audioElements = new Map(); // mp3 프리로드 캐시
    this.audioContext = null; // Web Audio API (비프음)

    // 한국어 음성 초기화
    this._initVoice();
    // Web Audio API 초기화
    this._initAudioContext();
  }

  /**
   * 한국어 음성 찾기 (비동기 로드 대응)
   */
  _initVoice() {
    const findKoreanVoice = () => {
      const voices = this.synth.getVoices();
      // 한국어 음성 우선순위: Google 한국어 > 기본 한국어 > 첫 번째 음성
      this.koreanVoice =
        voices.find(v => v.lang === 'ko-KR' && v.name.includes('Google')) ||
        voices.find(v => v.lang.startsWith('ko')) ||
        voices[0] || null;
    };

    findKoreanVoice();

    // 일부 브라우저에서 voiceschanged 이벤트 후 음성 목록이 로드됨
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = findKoreanVoice;
    }
  }

  /**
   * Web Audio API 초기화 (비프음용)
   */
  _initAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('[AudioManager] Web Audio API not available:', e);
    }
  }

  /**
   * Web Speech API로 텍스트를 음성으로 읽기
   * @param {string} text - 읽을 텍스트
   * @param {Object} options - 옵션 (rate, pitch, volume)
   * @returns {Promise<void>} 음성 재생 완료 시 resolve
   */
  speak(text, options = {}) {
    return new Promise((resolve) => {
      // 진행 중인 음성 취소
      this.synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ko-KR';
      utterance.rate = options.rate || 0.85;   // 시니어를 위해 천천히
      utterance.pitch = options.pitch || 1.0;
      utterance.volume = options.volume || 1.0;

      if (this.koreanVoice) {
        utterance.voice = this.koreanVoice;
      }

      utterance.onend = () => {
        this.isSpeaking = false;
        resolve();
      };

      utterance.onerror = (e) => {
        console.warn('[AudioManager] Speech error:', e.error);
        this.isSpeaking = false;
        resolve(); // 에러가 나도 플로우 중단하지 않음
      };

      this.isSpeaking = true;
      this.synth.speak(utterance);
    });
  }

  /**
   * 카운트 증가 시 짧은 비프음 재생
   * @param {number} frequency - 주파수 (Hz), 기본 880
   * @param {number} duration - 지속 시간 (ms), 기본 100
   */
  playBeep(frequency = 880, duration = 100) {
    if (!this.audioContext) return;

    try {
      // AudioContext가 suspended 상태면 resume
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);

      // 부드러운 페이드인/아웃
      gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, this.audioContext.currentTime + 0.01);
      gainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + duration / 1000);

      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + duration / 1000);
    } catch (e) {
      console.warn('[AudioManager] Beep error:', e);
    }
  }

  /**
   * 성공 비프음 (카운트 증가 시)
   */
  playCountBeep() {
    this.playBeep(880, 120);
  }

  /**
   * 마일스톤 달성 효과음 (연속 비프)
   */
  async playMilestoneSound() {
    this.playBeep(660, 100);
    await this._delay(120);
    this.playBeep(880, 100);
    await this._delay(120);
    this.playBeep(1100, 150);
  }

  /**
   * 완료 효과음
   */
  async playCompleteSound() {
    this.playBeep(523, 150);
    await this._delay(150);
    this.playBeep(659, 150);
    await this._delay(150);
    this.playBeep(784, 150);
    await this._delay(150);
    this.playBeep(1047, 300);
  }

  /**
   * mp3 파일 재생 (성우 음성 교체 시 사용)
   * @param {string} src - 오디오 파일 경로
   * @returns {Promise<void>} 재생 완료 시 resolve
   */
  playAudio(src) {
    return new Promise((resolve) => {
      let audio = this.audioElements.get(src);
      if (!audio) {
        audio = new Audio(src);
        this.audioElements.set(src, audio);
      }

      audio.currentTime = 0;
      audio.onended = () => {
        this.isSpeaking = false;
        resolve();
      };
      audio.onerror = () => {
        console.warn('[AudioManager] Audio file error:', src);
        this.isSpeaking = false;
        resolve();
      };

      this.isSpeaking = true;
      audio.play().catch(() => {
        console.warn('[AudioManager] Audio play blocked (user gesture needed)');
        this.isSpeaking = false;
        resolve();
      });
    });
  }

  /**
   * mp3 파일 사전 로드
   * @param {string[]} srcs - 프리로드할 파일 경로 배열
   */
  preload(srcs) {
    srcs.forEach(src => {
      if (!this.audioElements.has(src)) {
        const audio = new Audio();
        audio.preload = 'auto';
        audio.src = src;
        this.audioElements.set(src, audio);
      }
    });
  }

  /**
   * 카운트다운 음성 (3, 2, 1)
   * @returns {Promise<void>}
   */
  async speakCountdown() {
    for (let i = 3; i >= 1; i--) {
      await this.speak(String(i), { rate: 1.0 });
      // 간격을 위한 짧은 대기
      await this._delay(200);
    }
  }

  /**
   * 현재 재생 중인 음성 중지
   */
  stop() {
    this.synth.cancel();
    this.isSpeaking = false;
    // mp3도 중지
    this.audioElements.forEach(audio => {
      audio.pause();
      audio.currentTime = 0;
    });
  }

  /**
   * 유틸리티: 지연
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * PRD에 정의된 음성 대사 상수
 */
AudioManager.MESSAGES = Object.freeze({
  GREETING:      '안녕하세요. 오늘도 운동 시작해볼까요?',
  START:         '좋습니다. 운동을 시작하겠습니다.',
  ENCOURAGE:     '5번 성공했습니다. 조금만 더 힘내세요. 무릎을 조금 더 구부리면 안전합니다.',
  COMPLETE:      '오늘의 운동이 끝났습니다. 수고하셨습니다!',
  WAITING:       '초록색 위치에 서 주세요.',
  POSE_FOUND:    '좋은 자세입니다. 곧 시작합니다.',
  POSE_LOST:     '카메라 앞에 서 주세요.',
  NOTIFY_SENT:   '자녀에게 알림을 보냈습니다.',

  // 무릎 올리기 전용
  KNEE_RAISE_START:     '무릎을 번갈아 높이 올려주세요.',
  KNEE_RAISE_ENCOURAGE: '무릎을 좀 더 높이 올려보세요. 잘 하고 계세요!',
});

/**
 * 격려 메시지 풀 (랜덤 재생용)
 */
AudioManager.ENCOURAGE_POOL = Object.freeze([
  '잘 하고 계세요! 이 조자로 계속 해볼까요?',
  '대단합니다! 꾸준히 하면 건강해져요.',
  '아주 좋습니다! 조금만 더 힘내세요.',
  '멋져요! 자세가 아주 좋습니다.',
]);

/**
 * mp3 파일 경로 상수 (성우 음성 교체 시 사용)
 */
AudioManager.AUDIO_FILES = Object.freeze({
  GREETING:   'assets/audio/01_greeting.mp3',
  START:      'assets/audio/02_start.mp3',
  ENCOURAGE:  'assets/audio/03_encourage.mp3',
  COMPLETE:   'assets/audio/04_complete.mp3',
});
