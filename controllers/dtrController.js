const prisma = require('../prismaClient');
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

// PUBLIC KIOSK
exports.getKiosk = (req, res) => {
  res.render('dtr/kiosk', { title: 'DTR Kiosk' });
};

exports.postKiosk = async (req, res) => {
  const { userId, password, action } = req.body;
  try {
    const user = await prisma.user.findFirst({ where: { userId: userId.toUpperCase(), isActive: true } });
    if (!user || user.role === 'admin') {
      return res.json({ success: false, message: 'User ID not found.' });
    }
    const bcrypt = require('bcryptjs');
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.json({ success: false, message: 'Incorrect password. Please try again.' });
    }

    const today = moment().tz(PH_TZ).format('YYYY-MM-DD');
    let log = await prisma.dTRLog.findFirst({ where: { userId: user.userId, date: today } });

    if (action === 'time-in') {
      const now = new Date();
      const cutoffInfo = handleAfternoonCutoff(now);

      if (cutoffInfo.isClosed) {
        return res.json({ success: false, message: cutoffInfo.message || 'Clock-in not allowed at this time. Contact your administrator.' });
      }

      if (log) {
        if (log.status === 'completed') {
          return res.json({ success: false, message: 'You have already completed your shift for today.' });
        }
        if (log.isActive) {
          return res.json({ success: false, message: 'You are already clocked in.' });
        }

        let existingSessions = log.sessions || [];
        existingSessions.push({ timeIn: cutoffInfo.effectiveTime, timeOut: null, hours: 0 });

        const updateData = {
          isActive: true,
          status: 'in_progress',
          sessions: existingSessions
        };
        if (cutoffInfo.lateAfternoon) updateData.late_afternoon = true;

        log = await prisma.dTRLog.update({ where: { id: log.id }, data: updateData });
        const lateMinutes = cutoffInfo.lateAfternoon
          ? Math.round(moment(now).diff(moment(cutoffInfo.effectiveTime), 'minutes'))
          : 0;
        return res.json({
          success: true,
          message: 'Welcome back! Afternoon session started.',
          userName: user.name, userId: user.userId, userType: user.role,
          action: 'resume',
          isLateAfternoon: cutoffInfo.lateAfternoon,
          lateAfternoonMinutes: lateMinutes
        });
      }

      const lateMinutes = cutoffInfo.lateAfternoon
        ? Math.round(moment(now).diff(moment(cutoffInfo.effectiveTime), 'minutes'))
        : 0;
      log = await prisma.dTRLog.create({
        data: {
          user_id: user.id, userId: user.userId, userName: user.name,
          userType: user.role, date: today, timeIn: cutoffInfo.effectiveTime,
          late_afternoon: cutoffInfo.lateAfternoon,
          isActive: true, requiredHours: user.requiredHours || 8, status: 'in_progress'
        }
      });
      return res.json({
        success: true,
        message: `Good ${timeOfDay()}! Time In recorded.`,
        userName: user.name, userId: user.userId, userType: user.role,
        action: 'time-in',
        isLateAfternoon: cutoffInfo.lateAfternoon,
        lateAfternoonMinutes: lateMinutes
      });
    }

    if (action === 'time-out') {
      if (!log || !log.timeIn) return res.json({ success: false, message: 'No Time In found for today.' });
      if (log.status === 'completed') return res.json({ success: false, message: 'Already timed out for today.' });
      if (!log.isActive) return res.json({ success: false, message: 'You are on break. Clock back in first.' });

      const now = new Date();
      const shiftInfo = handleShiftEndCutoff(now);
      const effectiveOut = shiftInfo.effectiveTime;

      let sessions = log.sessions || [];
      if (sessions.length === 0) {
        log.timeOut = effectiveOut;
      } else {
        const last = sessions[sessions.length - 1];
        if (!last.timeOut) last.timeOut = effectiveOut;
        log.sessions = sessions;
      }

      log.isActive = false;
      log.status = 'completed';

      // calculate totals (uses capped timeOut if applicable)
      const calcs = calculateTotals(log);

      log = await prisma.dTRLog.update({
        where: { id: log.id },
        data: {
          timeOut: log.timeOut,
          sessions: calcs.sessions,
          isActive: false,
          status: 'completed',
          late_clockout: shiftInfo.lateClockout,
          totalHours: calcs.totalHours,
          overtimeHours: calcs.overtimeHours,
          undertimeHours: calcs.undertimeHours
        }
      });

      const outMsg = shiftInfo.capped
        ? `Time Out recorded (capped to shift end). Total: ${calcs.totalHours} hrs`
        : `Time Out recorded! Total: ${calcs.totalHours} hrs`;
      return res.json({ success: true, message: outMsg, action: 'time-out', lateClockout: shiftInfo.lateClockout, capped: shiftInfo.capped });
    }

    if (action === 'undo-timeout') {
      if (!log || log.status !== 'completed') return res.json({ success: false, message: 'Nothing to undo.' });
      let sessions = log.sessions || [];
      let lastOut = sessions.length > 0 ? sessions[sessions.length - 1].timeOut : log.timeOut;
      if (!lastOut) return res.json({ success: false, message: 'Nothing to undo.' });
      const minutesAgo = (Date.now() - new Date(lastOut)) / 60000;
      if (minutesAgo > 5) return res.json({ success: false, message: 'Undo window expired (5 minutes). Contact an admin.' });

      if (sessions.length > 0) {
        sessions[sessions.length - 1].timeOut = null;
        log.timeOut = null; // also clear root timeOut to prevent stale double-count in calculateTotals
      } else {
        log.timeOut = null;
      }
      log.sessions = sessions;
      log.isActive = true;
      log.status = 'in_progress';
      const calcs = calculateTotals(log);

      log = await prisma.dTRLog.update({
        where: { id: log.id },
        data: {
          timeOut: log.timeOut,
          sessions: calcs.sessions,
          isActive: true,
          status: 'in_progress',
          totalHours: calcs.totalHours,
          overtimeHours: calcs.overtimeHours,
          undertimeHours: calcs.undertimeHours
        }
      });
      return res.json({ success: true, message: 'Time Out undone! You are clocked back in.', action: 'undo' });
    }
  } catch (err) {
    console.error(err);
    return res.json({ success: false, message: 'Server error. Please try again.' });
  }
};

exports.getRecentLogs = async (req, res) => {
  try {
    const today = moment().tz(PH_TZ).format('YYYY-MM-DD');
    const logs = await prisma.dTRLog.findMany({
      where: { date: today },
      orderBy: { createdAt: 'desc' },
      take: 8
    });
    // Mask userId for privacy on public endpoint
    const maskedLogs = logs.map(l => ({
      ...l,
      userId: l.userId.substring(0, 3) + '****'
    }));
    res.json({ logs: maskedLogs });
  } catch (err) {
    res.json({ logs: [] });
  }
};

exports.getDTRPage = async (req, res) => {
  try {
    const { userId } = req.session.user;
    const today = moment().tz(PH_TZ).format('YYYY-MM-DD');
    const todayLog = await prisma.dTRLog.findFirst({ where: { userId, date: today } });
    res.render('dtr/index', { title: 'Time Record', user: req.session.user, todayLog, today });
  } catch (err) {
    console.error('getDTRPage error:', err);
    req.flash('error', 'Unable to load your time record. Please try again.');
    res.redirect('/login');
  }
};

exports.timeIn = async (req, res) => {
  const { userId, name, role } = req.session.user;
  const today = moment().tz(PH_TZ).format('YYYY-MM-DD');
  try {
    const userDoc = await prisma.user.findUnique({ where: { userId } });
    let existing = await prisma.dTRLog.findFirst({ where: { userId, date: today } });

    const now = new Date();
    const cutoffInfo = handleAfternoonCutoff(now);

    // Block clock-in outside allowed hours (too early in morning OR past afternoon cutoff)
    if (cutoffInfo.isClosed) {
      req.flash('error', cutoffInfo.message || 'Clock-in not allowed at this time. Contact your administrator.');
      return res.redirect('/dtr');
    }

    if (existing) {
      if (existing.status === 'completed') { req.flash('error', 'Shift already completed today.'); return res.redirect('/dtr'); }
      if (existing.isActive) { req.flash('error', 'Already clocked in.'); return res.redirect('/dtr'); }

      let sessions = existing.sessions || [];
      sessions.push({ timeIn: cutoffInfo.effectiveTime, timeOut: null, hours: 0 });
      let updateData = { isActive: true, status: 'in_progress', sessions };
      if (cutoffInfo.lateAfternoon) updateData.late_afternoon = true;

      await prisma.dTRLog.update({ where: { id: existing.id }, data: updateData });
      req.flash('success', 'Welcome back! Afternoon session started.');
      return res.redirect('/dtr');
    }

    await prisma.dTRLog.create({
      data: {
        user_id: userDoc.id, userId, userName: name, userType: role, date: today,
        timeIn: cutoffInfo.effectiveTime, late_afternoon: cutoffInfo.lateAfternoon,
        isActive: true, requiredHours: userDoc.requiredHours || 8, status: 'in_progress'
      }
    });
    req.flash('success', 'Time In recorded successfully!');
    res.redirect('/dtr');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error recording time in.');
    res.redirect('/dtr');
  }
};

exports.timeOut = async (req, res) => {
  const { userId } = req.session.user;
  const today = moment().tz(PH_TZ).format('YYYY-MM-DD');
  try {
    let log = await prisma.dTRLog.findFirst({ where: { userId, date: today } });
    if (!log) { req.flash('error', 'No Time In found for today.'); return res.redirect('/dtr'); }
    if (log.status === 'completed') { req.flash('error', 'Already timed out today.'); return res.redirect('/dtr'); }
    if (!log.isActive) { req.flash('error', 'You are on break. Time In first.'); return res.redirect('/dtr'); }

    const now = new Date();
    const shiftInfo = handleShiftEndCutoff(now);
    const effectiveOut = shiftInfo.effectiveTime;

    let sessions = log.sessions || [];
    if (sessions.length === 0) { log.timeOut = effectiveOut; }
    else {
      const last = sessions[sessions.length - 1];
      if (!last.timeOut) last.timeOut = effectiveOut;
      log.sessions = sessions;
    }

    const calcs = calculateTotals(log);

    await prisma.dTRLog.update({
      where: { id: log.id },
      data: {
        timeOut: log.timeOut,
        sessions: calcs.sessions,
        isActive: false,
        status: 'completed',
        late_clockout: shiftInfo.lateClockout,
        totalHours: calcs.totalHours,
        overtimeHours: calcs.overtimeHours,
        undertimeHours: calcs.undertimeHours
      }
    });

    if (shiftInfo.capped) {
      req.flash('warning', `Clock-out was past shift end — time capped to ${process.env.SHIFT_END || '17:00'}. Total: ${calcs.totalHours} hrs`);
    } else {
      req.flash('success', `Time Out recorded! Total: ${calcs.totalHours} hrs`);
    }
    res.redirect('/dtr');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error recording time out.');
    res.redirect('/dtr');
  }
};

exports.getMaintenanceDTR = async (req, res) => {
  try {
    const { search, dateFrom, dateTo } = req.query;
    let query = { userType: 'maintenance' };
    if (search) {
      query.OR = [{ userName: { contains: search, mode: 'insensitive' } }, { userId: { contains: search, mode: 'insensitive' } }];
    }
    if (dateFrom || dateTo) {
      query.date = {};
      if (dateFrom) query.date.gte = dateFrom;
      if (dateTo) query.date.lte = dateTo;
    }
    const logsDocs = await prisma.dTRLog.findMany({ where: query, orderBy: { date: 'desc' } });
    const logs = logsDocs.map(l => ({ ...l, _id: l.id }));
    res.render('admin/dtr-maintenance', { title: 'Maintenance DTR', logs, search, dateFrom, dateTo, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
};

exports.getStudentDTR = async (req, res) => {
  try {
    const { search, dateFrom, dateTo } = req.query;
    let query = { userType: 'student' };
    if (search) {
      query.OR = [{ userName: { contains: search, mode: 'insensitive' } }, { userId: { contains: search, mode: 'insensitive' } }];
    }
    if (dateFrom || dateTo) {
      query.date = {};
      if (dateFrom) query.date.gte = dateFrom;
      if (dateTo) query.date.lte = dateTo;
    }
    const logsDocs = await prisma.dTRLog.findMany({ where: query, orderBy: { date: 'desc' } });
    const logs = logsDocs.map(l => ({ ...l, _id: l.id }));
    res.render('admin/dtr-students', { title: 'Student DTR', logs, search, dateFrom, dateTo, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
};

exports.getSummary = async (req, res) => {
  try {
    const { userType = 'student', dateFrom, dateTo, userId } = req.query;
    const from = dateFrom || moment().tz(PH_TZ).startOf('month').format('YYYY-MM-DD');
    const to = dateTo || moment().tz(PH_TZ).format('YYYY-MM-DD');

    let query = { userType, date: { gte: from, lte: to } };
    if (userId) query.userId = userId;

    const logs = await prisma.dTRLog.findMany({ where: query, orderBy: { date: 'asc' } });
    const byEmployee = {};
    logs.forEach(log => {
      if (!byEmployee[log.userId]) {
        byEmployee[log.userId] = {
          userId: log.userId, userName: log.userName,
          days: 0, totalHours: 0, overtimeHours: 0, undertimeHours: 0,
          completedDays: 0, incompleteDays: 0, lateAfternoonCount: 0, lateClockoutCount: 0
        };
      }
      const e = byEmployee[log.userId];
      e.days++;
      e.totalHours += log.totalHours || 0;
      e.overtimeHours += log.overtimeHours || 0;
      e.undertimeHours += log.undertimeHours || 0;
      if (log.status === 'completed') e.completedDays++;
      else e.incompleteDays++;
      if (log.late_afternoon) e.lateAfternoonCount++;
      if (log.late_clockout) e.lateClockoutCount++;
    });
    const summaries = Object.values(byEmployee).map(e => ({
      ...e,
      totalHours: Math.round(e.totalHours * 100) / 100,
      overtimeHours: Math.round(e.overtimeHours * 100) / 100,
      undertimeHours: Math.round(e.undertimeHours * 100) / 100
    }));

    const users = await prisma.user.findMany({ where: { role: userType, isActive: true }, orderBy: { name: 'asc' } });
    res.render('admin/dtr-summary', { title: 'DTR Summary', summaries, userType, dateFrom: from, dateTo: to, userId, users: users.map(u => ({ ...u, _id: u.id })), user: req.session.user });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
};

exports.getEditLog = async (req, res) => {
  try {
    const logDoc = await prisma.dTRLog.findUnique({ where: { id: req.params.id } });
    if (!logDoc) return res.redirect('back');
    const log = { ...logDoc, _id: logDoc.id };
    res.render('admin/dtr-edit', { title: 'Edit Log', log, user: req.session.user });
  } catch (err) {
    res.redirect('back');
  }
};

exports.postEditLog = async (req, res) => {
  try {
    const { timeIn, timeOut, notes, requiredHours, late_afternoon, late_clockout } = req.body;
    let log = await prisma.dTRLog.findUnique({ where: { id: req.params.id } });

    if (timeIn) log.timeIn = new Date(timeIn);
    if (timeOut) { log.timeOut = new Date(timeOut); log.isActive = false; log.status = 'completed'; }
    if (requiredHours) log.requiredHours = parseFloat(requiredHours);
    log.late_afternoon = late_afternoon === 'on';
    log.late_clockout  = late_clockout  === 'on';
    log.notes = notes;

    const calcs = calculateTotals(log);

    await prisma.dTRLog.update({
      where: { id: req.params.id },
      data: {
        timeIn: log.timeIn,
        timeOut: log.timeOut,
        isActive: log.isActive,
        status: log.status,
        requiredHours: log.requiredHours,
        late_afternoon: log.late_afternoon,
        late_clockout: log.late_clockout,
        notes: log.notes,
        totalHours: calcs.totalHours,
        overtimeHours: calcs.overtimeHours,
        undertimeHours: calcs.undertimeHours
      }
    });

    req.flash('success', 'Log updated successfully.');
    res.redirect(log.userType === 'maintenance' ? '/admin/dtr/maintenance' : '/admin/dtr/students');
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
};

exports.deleteLog = async (req, res) => {
  try {
    const log = await prisma.dTRLog.delete({ where: { id: req.params.id } });
    req.flash('success', 'Log deleted.');
    res.redirect(log.userType === 'maintenance' ? '/admin/dtr/maintenance' : '/admin/dtr/students');
  } catch (err) {
    res.redirect('back');
  }
};

exports.getAbsenceSummary = async (req, res) => {
  try {
    const { type = 'all', from, to } = req.query;
    const dateFrom = from || moment().tz(PH_TZ).startOf('month').format('YYYY-MM-DD');
    const dateTo = to || moment().tz(PH_TZ).format('YYYY-MM-DD');

    let userQuery = { role: { not: 'admin' }, isActive: true };
    if (type !== 'all') { userQuery.role = type; }

    const users = await prisma.user.findMany({ where: userQuery });
    const startObj = moment(dateFrom);
    const endObj = moment(dateTo);
    let scheduledDays = 0;
    if (endObj.diff(startObj, 'days') >= 0) {
      scheduledDays = endObj.diff(startObj, 'days') + 1;
    }

    const reports = await Promise.all(users.map(async (u) => {
      // Prisma distinct not immediately returning unique strings like mongoose distinct('date') does easily
      // We can group by date to find distinct days
      const days = await prisma.dTRLog.groupBy({
        by: ['date'],
        where: {
          userId: u.userId,
          date: { gte: dateFrom, lte: dateTo },
          status: 'completed'
        }
      });
      const daysWorked = days.length;
      let absentDays = scheduledDays - daysWorked;
      if (absentDays < 0) absentDays = 0;
      let absenceRate = scheduledDays > 0 ? (absentDays / scheduledDays) * 100 : 0;

      return {
        name: u.name, userId: u.userId, role: u.role,
        scheduledDays, absentDays, absenceRate
      };
    }));

    reports.sort((a, b) => a.name.localeCompare(b.name));
    res.render('admin/absence-summary', { title: 'Absence Summary Report', reports, type, dateFrom, dateTo, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
};
