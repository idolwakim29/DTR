const moment = require('moment-timezone');
const PH_TZ = 'Asia/Manila';

function timeOfDay() {
  const h = moment().tz(PH_TZ).hour(); // use PH local hour, not UTC
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

function handleAfternoonCutoff(nowDate) {
  const cutoffStr = process.env.AFTERNOON_CUTOFF || '13:30';
  const [cutoffH, cutoffM] = cutoffStr.split(':').map(Number);

  // Morning restriction: block unrealistically early clock-ins (default: before 6:00 AM)
  const morningStartHour = parseInt(process.env.MORNING_START_HOUR || '6', 10);
  const mNow = moment.tz(nowDate, PH_TZ);  // interpret in PH time

  if (mNow.hour() < morningStartHour) {
    return { isClosed: true, lateAfternoon: false, effectiveTime: nowDate,
             message: `Clock-in is not allowed before ${morningStartHour}:00 AM.` };
  }

  const cutoffTime = moment.tz(nowDate, PH_TZ).hour(cutoffH).minute(cutoffM).second(0).millisecond(0);

  if (mNow.hour() >= 12) {
    if (mNow.isAfter(cutoffTime)) {
      const minutesLate = mNow.diff(cutoffTime, 'minutes');
      if (minutesLate >= 60) {   // fixed: was > 60, now >= 60 so exactly 60 min late is also blocked
        return { isClosed: true, lateAfternoon: false, effectiveTime: nowDate,
                 message: 'Afternoon log-in window closed. Contact your administrator.' };
      }
      return { isClosed: false, lateAfternoon: true, effectiveTime: cutoffTime.toDate() };
    }
  }
  return { isClosed: false, lateAfternoon: false, effectiveTime: nowDate };
}

function handleShiftEndCutoff(nowDate) {
  const shiftEndStr = process.env.SHIFT_END || '17:00';
  const [endH, endM] = shiftEndStr.split(':').map(Number);
  const graceMinutes = parseInt(process.env.LATE_CLOCKOUT_WINDOW || '30', 10);

  const mNow = moment.tz(nowDate, PH_TZ);  // interpret in PH time
  const shiftEndTime = moment.tz(nowDate, PH_TZ).hour(endH).minute(endM).second(0).millisecond(0);

  // Only applies when clocking out AFTER the official shift end
  if (mNow.isAfter(shiftEndTime)) {
    const minutesLate = mNow.diff(shiftEndTime, 'minutes');
    if (minutesLate > graceMinutes) {
      // Clocked out too late — cap timeOut to shift end so no false overtime
      return {
        effectiveTime: shiftEndTime.toDate(),
        lateClockout: true,
        capped: true,
        message: `Your clock-out time was capped to ${shiftEndStr} (you were ${minutesLate} min past shift end).`
      };
    }
    // Within grace window — keep actual time but flag it
    return { effectiveTime: nowDate, lateClockout: true, capped: false, message: null };
  }

  return { effectiveTime: nowDate, lateClockout: false, capped: false, message: null };
}

const excludeLunchTime = (timeIn, timeOut) => {
  const LUNCH_START = 12; // 12 PM PH time
  const LUNCH_END = 13;   // 1 PM PH time

  if (!timeIn || !timeOut) return 0;

  const start = new Date(timeIn);
  const end   = new Date(timeOut);

  // IMPORTANT: use PH timezone hours — getHours() returns UTC on Vercel servers
  const startHour = moment.tz(start, PH_TZ).hour() + moment.tz(start, PH_TZ).minute() / 60;
  const endHour   = moment.tz(end,   PH_TZ).hour() + moment.tz(end,   PH_TZ).minute() / 60;

  // Duration in hours (millisecond arithmetic is timezone-agnostic — always correct)
  const rawHours = (end - start) / (1000 * 60 * 60);

  if (endHour <= LUNCH_START || startHour >= LUNCH_END) {
    return rawHours;
  }
  if (startHour <= LUNCH_START && endHour >= LUNCH_END) {
    return rawHours - 1;
  }
  if (startHour < LUNCH_START && endHour > LUNCH_START) {
    const lunchOverlap = Math.min(endHour, LUNCH_END) - LUNCH_START;
    return rawHours - lunchOverlap;
  }
  if (startHour < LUNCH_END && endHour > LUNCH_END) {
    const lunchOverlap = LUNCH_END - Math.max(startHour, LUNCH_START);
    return rawHours - lunchOverlap;
  }
  return rawHours;
};

function calculateTotals(logData) {
  let total = 0;
  if (logData.timeIn && logData.timeOut) {
    total += excludeLunchTime(logData.timeIn, logData.timeOut);
  }
  let sessions = logData.sessions || [];
  if (typeof sessions === 'string') {
    try {
      sessions = JSON.parse(sessions);
    } catch (e) { }
  }
  sessions.forEach(s => {
    if (s.timeIn && s.timeOut) {
      const h = excludeLunchTime(s.timeIn, s.timeOut);
      s.hours = Math.round(h * 100) / 100;
      total += h;
    }
  });

  const totalHours = Math.round(total * 100) / 100;
  const req = logData.requiredHours || 8;
  let overtimeHours = 0;
  let undertimeHours = 0;

  if (totalHours >= req) {
    overtimeHours = Math.round((totalHours - req) * 100) / 100;
  } else {
    undertimeHours = Math.round((req - totalHours) * 100) / 100;
  }
  return { totalHours, overtimeHours, undertimeHours, sessions };
}

module.exports = {
  timeOfDay,
  handleAfternoonCutoff,
  handleShiftEndCutoff,
  excludeLunchTime,
  calculateTotals,
  PH_TZ
};
