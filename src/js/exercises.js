/**
 * exercises.js - 운동 타입 정의 및 포즈 분석 로직 모듈
 *
 * 각 운동은 동일한 인터페이스(analyze 함수)를 제공하며,
 * UP/DOWN 상태를 반환하여 기존 ExerciseCounter와 호환됩니다.
 *
 * 새 운동 추가 시: ExerciseType에 키 추가 → EXERCISE_CONFIG에 설정 추가
 */

// ============================
// 운동 타입 열거
// ============================
export const ExerciseType = Object.freeze({
  MANSE:      'manse',       // 만세 운동
  KNEE_RAISE: 'knee_raise',  // 무릎 올리기 (제자리 걷기)
});

// ============================
// 운동별 설정 및 분석 로직
// ============================
export const EXERCISE_CONFIG = {
  // ---------------------------
  // 만세 운동 (기존)
  // ---------------------------
  [ExerciseType.MANSE]: {
    name: '만세 운동',
    icon: '🙌',
    description: '팔을 위로 올렸다 내려요',
    waitingPose: 'UP',           // 대기 시 기대하는 시작 포즈
    waitingMessage: '두 팔을 높이 올려주세요',
    debugLabels: { left: '왼손목', right: '오른손목' },

    /**
     * 만세 동작 분석
     * UP: 양 손목이 어깨 위 → DOWN: 양 손목이 어깨 아래
     * @param {Array} landmarks - MediaPipe 33개 관절 랜드마크
     * @returns {Object} 포즈 상태
     */
    analyze(landmarks) {
      const leftShoulder = landmarks[11];
      const rightShoulder = landmarks[12];
      const leftElbow = landmarks[13];
      const rightElbow = landmarks[14];
      const leftWrist = landmarks[15];
      const rightWrist = landmarks[16];
      const leftHip = landmarks[23];
      const rightHip = landmarks[24];

      // 기준선 계산 (y는 위로 갈수록 작아짐)
      const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
      const hipY = (leftHip.y + rightHip.y) / 2;
      const bodyLength = hipY - shoulderY;

      // UP 기준: 손목이 어깨보다 위 (마진 10%)
      const upThresholdY = shoulderY - bodyLength * 0.1;
      // DOWN 기준: 손목이 어깨보다 확실히 아래 (마진 30%)
      const downThresholdY = shoulderY + bodyLength * 0.3;

      const leftWristUp = leftWrist.y < upThresholdY;
      const rightWristUp = rightWrist.y < upThresholdY;
      const leftWristDown = leftWrist.y > downThresholdY;
      const rightWristDown = rightWrist.y > downThresholdY;

      // 팔꿈치 보조 지표
      const elbowsUp = leftElbow.y < shoulderY && rightElbow.y < shoulderY;

      // 가시성 평균
      const visibility = [leftShoulder, rightShoulder, leftWrist, rightWrist, leftHip, rightHip]
        .reduce((sum, lm) => sum + (lm.visibility || 0), 0) / 6;

      // 상태 판별
      let state = 'TRANSITIONING';
      if ((leftWristUp && rightWristUp) || (elbowsUp && leftWristUp) || (elbowsUp && rightWristUp)) {
        state = 'UP';
      } else if (leftWristDown && rightWristDown) {
        state = 'DOWN';
      }

      // 디버그 값: 손목 높이 (양수 = 어깨 위)
      const leftDebug = Math.round((shoulderY - leftWrist.y) * 100);
      const rightDebug = Math.round((shoulderY - rightWrist.y) * 100);

      return {
        detected: true,
        state,
        leftDebugValue: leftDebug,
        rightDebugValue: rightDebug,
        confidence: Math.round(visibility * 100),
      };
    },

    /** 강조할 관절 인덱스 (어깨, 팔꿈치, 손목) */
    highlightJoints: [11, 12, 13, 14, 15, 16],
  },

  // ---------------------------
  // 무릎 올리기 (제자리 걷기)
  // ---------------------------
  [ExerciseType.KNEE_RAISE]: {
    name: '무릎 올리기',
    icon: '🦵',
    description: '무릎을 번갈아 올려요',
    waitingPose: 'DOWN',          // 대기 시 서있는 자세
    waitingMessage: '편하게 서 주세요',
    debugLabels: { left: '왼무릎', right: '오른무릎' },

    /**
     * 무릎 올리기 동작 분석
     * - UP: 한쪽 무릎이 충분히 올라감 (좌 또는 우)
     * - DOWN: 양쪽 다리가 정상 위치 (서 있는 자세)
     *
     * 랜드마크 인덱스:
     *   23/24: 엉덩이 (hip)
     *   25/26: 무릎 (knee)
     *   27/28: 발목 (ankle)
     *
     * @param {Array} landmarks - MediaPipe 33개 관절 랜드마크
     * @returns {Object} 포즈 상태
     */
    analyze(landmarks) {
      const leftHip = landmarks[23];
      const rightHip = landmarks[24];
      const leftKnee = landmarks[25];
      const rightKnee = landmarks[26];
      const leftAnkle = landmarks[27];
      const rightAnkle = landmarks[28];

      // 기준선: 엉덩이 Y좌표 평균
      const hipY = (leftHip.y + rightHip.y) / 2;

      // 다리 길이 = 엉덩이~발목 평균 거리 (정규화 기준)
      const leftLegLength = leftAnkle.y - leftHip.y;
      const rightLegLength = rightAnkle.y - rightHip.y;
      const avgLegLength = (leftLegLength + rightLegLength) / 2;

      // 무릎 높이 비율 계산
      // 정상 서 있을 때: 무릎은 엉덩이~발목의 약 50% 지점
      // 올렸을 때: 무릎이 엉덩이에 가까워짐 (비율 감소)
      const leftKneeRatio = (leftKnee.y - leftHip.y) / leftLegLength;   // 0에 가까울수록 올린 것
      const rightKneeRatio = (rightKnee.y - rightHip.y) / rightLegLength;

      // UP 기준: 무릎 비율이 0.35 이하 (다리 길이의 35% 이내로 올림)
      const UP_THRESHOLD = 0.35;
      // DOWN 기준: 양쪽 무릎 비율이 0.45 이상 (정상 위치)
      const DOWN_THRESHOLD = 0.45;

      const leftKneeUp = leftKneeRatio < UP_THRESHOLD && leftLegLength > 0.05;
      const rightKneeUp = rightKneeRatio < UP_THRESHOLD && rightLegLength > 0.05;
      const leftKneeDown = leftKneeRatio > DOWN_THRESHOLD;
      const rightKneeDown = rightKneeRatio > DOWN_THRESHOLD;

      // 가시성 평균
      const visibility = [leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle]
        .reduce((sum, lm) => sum + (lm.visibility || 0), 0) / 6;

      // 상태 판별
      let state = 'TRANSITIONING';
      if (leftKneeUp || rightKneeUp) {
        state = 'UP';   // 한쪽이라도 무릎을 올리면 UP
      } else if (leftKneeDown && rightKneeDown) {
        state = 'DOWN'; // 양쪽 다 정상 위치면 DOWN
      }

      // 디버그 값: 무릎 높이 비율 (% 단위, 작을수록 많이 올린 것)
      const leftDebug = Math.round(leftKneeRatio * 100);
      const rightDebug = Math.round(rightKneeRatio * 100);

      return {
        detected: true,
        state,
        leftDebugValue: leftDebug,
        rightDebugValue: rightDebug,
        confidence: Math.round(visibility * 100),
      };
    },

    /** 강조할 관절 인덱스 (엉덩이, 무릎, 발목) */
    highlightJoints: [23, 24, 25, 26, 27, 28],
  },
};

/**
 * 운동 설정 가져오기 (안전한 접근)
 * @param {string} exerciseType - ExerciseType 값
 * @returns {Object} 운동 설정
 */
export function getExerciseConfig(exerciseType) {
  return EXERCISE_CONFIG[exerciseType] || EXERCISE_CONFIG[ExerciseType.MANSE];
}
