/**
 * ExerciseHistory - 운동 이력 저장/조회 모듈
 *
 * 운동 완료 시 localStorage에 기록을 저장합니다.
 * 최근 30일 기록을 유지하고 오래된 것은 자동 삭제합니다.
 * 4주차 현장 테스트에서 데이터 검증에 활용됩니다.
 *
 * 사용법:
 *   const history = new ExerciseHistory();
 *   history.addRecord({ exerciseName: '만세 운동', ... });
 *   const records = history.getRecords();
 *   const todayRecords = history.getTodayRecords();
 */
export class ExerciseHistory {
  constructor() {
    this.STORAGE_KEY = 'silverstep_exercise_history';
    this.MAX_DAYS = 30; // 최대 보관 일수
    this.MAX_RECORDS = 200; // 최대 레코드 수 (안전 한도)
  }

  /**
   * 운동 기록 추가
   * @param {Object} record
   * @param {string} record.exerciseName - 운동 이름
   * @param {string} record.exerciseIcon - 운동 아이콘
   * @param {number} record.totalReps - 총 횟수
   * @param {number} record.targetReps - 목표 횟수
   * @param {number} record.durationSeconds - 소요 시간 (초)
   * @param {boolean} record.notificationSent - 알림 전송 여부
   * @returns {Object} 저장된 기록
   */
  addRecord(record) {
    const records = this._loadRecords();

    const entry = {
      id: this._generateId(),
      timestamp: new Date().toISOString(),
      date: new Date().toLocaleDateString('ko-KR'),
      exerciseName: record.exerciseName || '운동',
      exerciseIcon: record.exerciseIcon || '🏃',
      totalReps: record.totalReps || 0,
      targetReps: record.targetReps || 10,
      durationSeconds: record.durationSeconds || 0,
      notificationSent: record.notificationSent || false,
    };

    records.unshift(entry);
    this._saveRecords(records);

    console.log('[History] 운동 기록 저장:', entry);
    return entry;
  }

  /**
   * 전체 기록 조회 (최신순)
   * @returns {Array} 운동 기록 배열
   */
  getRecords() {
    return this._loadRecords();
  }

  /**
   * 오늘의 기록만 조회
   * @returns {Array}
   */
  getTodayRecords() {
    const today = new Date().toLocaleDateString('ko-KR');
    return this._loadRecords().filter(r => r.date === today);
  }

  /**
   * 오늘의 통계 요약
   * @returns {Object} { totalSessions, totalReps, totalDuration }
   */
  getTodaySummary() {
    const today = this.getTodayRecords();
    return {
      totalSessions: today.length,
      totalReps: today.reduce((sum, r) => sum + (r.totalReps || 0), 0),
      totalDuration: today.reduce((sum, r) => sum + (r.durationSeconds || 0), 0),
    };
  }

  /**
   * 특정 기록의 알림 전송 상태 업데이트
   * @param {string} recordId
   * @param {boolean} sent
   */
  updateNotificationStatus(recordId, sent) {
    const records = this._loadRecords();
    const record = records.find(r => r.id === recordId);
    if (record) {
      record.notificationSent = sent;
      this._saveRecords(records);
    }
  }

  /**
   * 전체 기록 삭제
   */
  clearAll() {
    localStorage.removeItem(this.STORAGE_KEY);
    console.log('[History] 전체 기록 삭제');
  }

  /**
   * 기록 수 조회
   * @returns {number}
   */
  get count() {
    return this._loadRecords().length;
  }

  // ============================
  // 내부 메서드
  // ============================

  /**
   * localStorage에서 기록 로드 + 오래된 기록 자동 정리
   * @private
   * @returns {Array}
   */
  _loadRecords() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      let records = raw ? JSON.parse(raw) : [];

      // 30일 이전 기록 삭제
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - this.MAX_DAYS);
      const cutoffISO = cutoff.toISOString();

      const before = records.length;
      records = records.filter(r => r.timestamp >= cutoffISO);

      // 최대 레코드 수 초과 시 잘라냄
      if (records.length > this.MAX_RECORDS) {
        records = records.slice(0, this.MAX_RECORDS);
      }

      // 정리됐으면 다시 저장
      if (records.length !== before) {
        this._saveRecords(records);
      }

      return records;
    } catch {
      return [];
    }
  }

  /**
   * localStorage에 기록 저장
   * @private
   */
  _saveRecords(records) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(records));
    } catch (e) {
      console.warn('[History] 저장 실패:', e);
    }
  }

  /**
   * 고유 ID 생성 (타임스탬프 + 랜덤)
   * @private
   */
  _generateId() {
    return `ex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * 시간 포맷팅 (초 → "X분 Y초")
   * @param {number} seconds
   * @returns {string}
   */
  static formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
  }

  // ============================
  // 데이터 내보내기 (4주차 현장 검증)
  // ============================

  /**
   * 전체 이력을 JSON 파일로 다운로드
   */
  exportToJSON() {
    const records = this._loadRecords();
    const exportData = {
      exportDate: new Date().toISOString(),
      totalRecords: records.length,
      todaySummary: this.getTodaySummary(),
      weeklySummary: this.getWeeklySummary(),
      records,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `silverstep_history_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('[History] JSON 내보내기 완료:', records.length, '건');
  }

  /**
   * 전체 이력을 CSV 파일로 다운로드 (엑셀 호환)
   */
  exportToCSV() {
    const records = this._loadRecords();

    // BOM + 헤더
    const BOM = '\uFEFF';
    const headers = ['날짜', '시간', '운동', '아이콘', '횟수', '목표', '시간(초)', '알림전송'];
    const rows = records.map(r => {
      const dt = new Date(r.timestamp);
      const date = dt.toLocaleDateString('ko-KR');
      const time = dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      return [
        date,
        time,
        r.exerciseName || '',
        r.exerciseIcon || '',
        r.totalReps || 0,
        r.targetReps || 0,
        r.durationSeconds || 0,
        r.notificationSent ? 'O' : 'X',
      ].join(',');
    });

    const csv = BOM + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `silverstep_history_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('[History] CSV 내보내기 완료:', records.length, '건');
  }

  /**
   * 주간 운동 요약 통계
   * @returns {Object} { daysActive, totalSessions, totalReps, totalDuration, avgRepsPerSession, dailyBreakdown }
   */
  getWeeklySummary() {
    const records = this._loadRecords();
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoISO = weekAgo.toISOString();

    const weekRecords = records.filter(r => r.timestamp >= weekAgoISO);

    // 일별 그룹핑
    const dailyMap = {};
    weekRecords.forEach(r => {
      const day = r.date || new Date(r.timestamp).toLocaleDateString('ko-KR');
      if (!dailyMap[day]) {
        dailyMap[day] = { sessions: 0, reps: 0, duration: 0 };
      }
      dailyMap[day].sessions++;
      dailyMap[day].reps += r.totalReps || 0;
      dailyMap[day].duration += r.durationSeconds || 0;
    });

    const totalSessions = weekRecords.length;
    const totalReps = weekRecords.reduce((sum, r) => sum + (r.totalReps || 0), 0);
    const totalDuration = weekRecords.reduce((sum, r) => sum + (r.durationSeconds || 0), 0);

    return {
      periodStart: weekAgo.toLocaleDateString('ko-KR'),
      periodEnd: now.toLocaleDateString('ko-KR'),
      daysActive: Object.keys(dailyMap).length,
      totalSessions,
      totalReps,
      totalDuration,
      avgRepsPerSession: totalSessions > 0 ? Math.round(totalReps / totalSessions) : 0,
      dailyBreakdown: dailyMap,
    };
  }
}
