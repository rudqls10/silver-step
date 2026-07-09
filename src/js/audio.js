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

    // 한국어 음성 초기화
    this._initVoice();
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
  GREETING:   '안녕하세요. 오늘도 운동 시작해볼까요?',
  START:      '좋습니다. 운동을 시작하겠습니다.',
  ENCOURAGE:  '5번 성공했습니다. 조금만 더 힘내세요. 무릎을 조금 더 구부리면 안전합니다.',
  COMPLETE:   '오늘의 운동이 끝났습니다. 수고하셨습니다!',
  WAITING:    '초록색 위치에 서 주세요.',
  POSE_FOUND: '좋은 자세입니다. 곧 시작합니다.',
});

/**
 * mp3 파일 경로 상수 (성우 음성 교체 시 사용)
 */
AudioManager.AUDIO_FILES = Object.freeze({
  GREETING:   'assets/audio/01_greeting.mp3',
  START:      'assets/audio/02_start.mp3',
  ENCOURAGE:  'assets/audio/03_encourage.mp3',
  COMPLETE:   'assets/audio/04_complete.mp3',
});
