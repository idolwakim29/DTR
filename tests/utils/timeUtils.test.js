const {
  timeOfDay,
  handleAfternoonCutoff,
  handleShiftEndCutoff,
  excludeLunchTime,
  calculateTotals,
  PH_TZ
} = require('../../utils/timeUtils');

const moment = require('moment-timezone');

describe('timeUtils', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('excludeLunchTime', () => {
    it('should exclude 1 hour if shifting spans entirely over lunch (12PM to 1PM)', () => {
      // 8 AM to 5 PM
      const timeIn = moment.tz('2024-05-18 08:00:00', PH_TZ).toDate();
      const timeOut = moment.tz('2024-05-18 17:00:00', PH_TZ).toDate();
      
      const hours = excludeLunchTime(timeIn, timeOut);
      expect(hours).toBeCloseTo(8); // 9 hours total - 1 hour lunch
    });

    it('should not exclude lunch if shift ends before 12 PM', () => {
      // 8 AM to 11 AM
      const timeIn = moment.tz('2024-05-18 08:00:00', PH_TZ).toDate();
      const timeOut = moment.tz('2024-05-18 11:00:00', PH_TZ).toDate();

      const hours = excludeLunchTime(timeIn, timeOut);
      expect(hours).toBeCloseTo(3);
    });

    it('should partially exclude lunch if timeOut is exactly 12:30 PM', () => {
      const timeIn = moment.tz('2024-05-18 08:00:00', PH_TZ).toDate();
      const timeOut = moment.tz('2024-05-18 12:30:00', PH_TZ).toDate();

      // 4.5 raw hours - 0.5 lunch overlap = 4 hours
      const hours = excludeLunchTime(timeIn, timeOut);
      expect(hours).toBeCloseTo(4);
    });
  });

  describe('calculateTotals', () => {
    it('should calculate correct total, undertime, and overtime', () => {
      const logData = {
        timeIn: moment.tz('2024-05-18 08:00:00', PH_TZ).toDate(),
        timeOut: moment.tz('2024-05-18 18:00:00', PH_TZ).toDate(),
        requiredHours: 8
      };
      
      // 8 AM to 6 PM is 10 hours - 1 hour = 9 hours worked. req = 8, ot = 1
      const calcs = calculateTotals(logData);
      expect(calcs.totalHours).toBe(9);
      expect(calcs.overtimeHours).toBe(1);
      expect(calcs.undertimeHours).toBe(0);
    });
  });

  describe('handleAfternoonCutoff', () => {
    beforeEach(() => {
      process.env.AFTERNOON_CUTOFF = '13:30';
      process.env.MORNING_START_HOUR = '6';
    });

    it('should allow normal morning clock-in at 7:00 AM', () => {
      const time = moment.tz('2024-05-18 07:00:00', PH_TZ).toDate();
      const res = handleAfternoonCutoff(time);
      expect(res.isClosed).toBe(false);
      expect(res.lateAfternoon).toBe(false);
    });

    it('should block clock-in before 6:00 AM', () => {
      const time = moment.tz('2024-05-18 05:30:00', PH_TZ).toDate();
      const res = handleAfternoonCutoff(time);
      expect(res.isClosed).toBe(true);
      expect(res.message).toContain('before 6:00 AM');
    });

    it('should flag late afternoon if clocked in at 1:45 PM', () => {
      const time = moment.tz('2024-05-18 13:45:00', PH_TZ).toDate();
      const res = handleAfternoonCutoff(time);
      expect(res.isClosed).toBe(false);
      expect(res.lateAfternoon).toBe(true);
      // Effective time is the cutoff time (1:30 PM)
      expect(res.effectiveTime).toEqual(moment.tz('2024-05-18 13:30:00', PH_TZ).toDate());
    });

    it('should block extremely late afternoon (>= 60 min late)', () => {
      const time = moment.tz('2024-05-18 14:30:00', PH_TZ).toDate();
      const res = handleAfternoonCutoff(time);
      expect(res.isClosed).toBe(true);
      expect(res.message).toMatch(/window closed/i);
    });
  });

  describe('handleShiftEndCutoff', () => {
    beforeEach(() => {
      process.env.SHIFT_END = '17:00';
      process.env.LATE_CLOCKOUT_WINDOW = '30';
    });

    it('should cap time if clock out is past grace period', () => {
      const time = moment.tz('2024-05-18 18:00:00', PH_TZ).toDate();
      const res = handleShiftEndCutoff(time);
      expect(res.capped).toBe(true);
      expect(res.lateClockout).toBe(true);
      // effective time gets capped to 17:00
      expect(res.effectiveTime).toEqual(moment.tz('2024-05-18 17:00:00', PH_TZ).toDate());
    });

    it('should not cap time if within grace period, just flag late', () => {
      const time = moment.tz('2024-05-18 17:15:00', PH_TZ).toDate();
      const res = handleShiftEndCutoff(time);
      expect(res.capped).toBe(false);
      expect(res.lateClockout).toBe(true);
      expect(res.effectiveTime).toEqual(time);
    });
  });
});
