/**
 * ExerciseCounter - 운동 횟수 카운팅 모듈
 * 포즈 상태(UP/DOWN)를 받아 운동 횟수를 추적합니다.
 * 
 * 사용법:
 *   const counter = new ExerciseCounter({
 *     targetCount: 10,
 *     milestones: [5],
 *     onCountUpdate: (count, target) => { ... },
 *     onMilestone: (count) => { ... },
 *     onComplete: (count) => { ... },
 *   });
 *   counter.update('DOWN'); // 포즈 상태 업데이트
 *   counter.update('UP');   // → count +1
 */
export class ExerciseCounter {
  /**
   * @param {Object} options
   * @param {number} options.targetCount - 목표 운동 횟수 (기본값: 10)
   * @param {number[]} options.milestones - 격려 메시지 트리거 횟수 (기본값: [5])
   * @param {Function} options.onCountUpdate - 카운트 변경 시 콜백 (count, target)
   * @param {Function} options.onMilestone - 마일스톤 도달 시 콜백 (count)
   * @param {Function} options.onComplete - 목표 달성 시 콜백 (count)
   */
  constructor(options = {}) {
    this.targetCount = options.targetCount || 10;
    this.count = 0;
    this.lastState = null; // 'UP' or 'DOWN'
    this.milestones = options.milestones || [5];
    this.isComplete = false;

    // 최소 상태 유지 프레임 (노이즈 방지)
    this.stateBuffer = [];
    this.bufferSize = options.bufferSize || 3;

    // Callbacks
    this.onCountUpdate = options.onCountUpdate || (() => {});
    this.onMilestone = options.onMilestone || (() => {});
    this.onComplete = options.onComplete || (() => {});
  }

  /**
   * 포즈 상태 업데이트
   * DOWN → UP 전환 시 1회 카운트
   * @param {'UP'|'DOWN'|'TRANSITIONING'|null} rawState - 현재 포즈 상태
   */
  update(rawState) {
    if (!rawState || rawState === 'TRANSITIONING' || this.isComplete) return;

    // 상태 버퍼에 추가 (노이즈 필터링)
    this.stateBuffer.push(rawState);
    if (this.stateBuffer.length > this.bufferSize) {
      this.stateBuffer.shift();
    }

    // 버퍼의 과반수가 동일한 상태일 때만 상태 전환
    const state = this._getStableState();
    if (!state || state === this.lastState) return;

    // DOWN → UP 전환 시 1회 카운트
    if (this.lastState === 'DOWN' && state === 'UP') {
      this.count++;
      this.onCountUpdate(this.count, this.targetCount);

      // 마일스톤 체크
      if (this.milestones.includes(this.count)) {
        this.onMilestone(this.count);
      }

      // 목표 달성 체크
      if (this.count >= this.targetCount) {
        this.isComplete = true;
        this.onComplete(this.count);
      }
    }

    this.lastState = state;
  }

  /**
   * 버퍼에서 안정된 상태 추출 (노이즈 필터링)
   * @returns {'UP'|'DOWN'|null}
   */
  _getStableState() {
    if (this.stateBuffer.length < this.bufferSize) return null;

    const upCount = this.stateBuffer.filter(s => s === 'UP').length;
    const downCount = this.stateBuffer.filter(s => s === 'DOWN').length;
    const threshold = Math.ceil(this.bufferSize / 2);

    if (upCount >= threshold) return 'UP';
    if (downCount >= threshold) return 'DOWN';
    return null;
  }

  /**
   * 진행률 (0~1)
   */
  get progress() {
    return Math.min(this.count / this.targetCount, 1);
  }

  /**
   * 카운터 초기화
   */
  reset() {
    this.count = 0;
    this.lastState = null;
    this.isComplete = false;
    this.stateBuffer = [];
  }
}
