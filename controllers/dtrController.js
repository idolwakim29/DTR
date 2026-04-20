const prisma = require('../prismaClient');
const moment = require('moment');

function timeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

function handleAfternoonCutoff(nowDate) {
  const cutoffStr = process.env.AFTERNOON_CUTOFF || '13:30';
  const [cutoffH, cutoffM] = cutoffStr.split(':').map(Number);

  const mNow = moment(nowDate);
  const cutoffTime = moment(nowDate).hour(cutoffH).minute(cutoffM).second(0).millisecond(0);

  if (mNow.hour() >= 12) {
    if (mNow.isAfter(cutoffTime)) {
      const minutesLate = mNow.diff(cutoffTime, 'minutes');
      if (minutesLate > 60) {
        return { isClosed: true, lateAfternoon: false, effectiveTime: nowDate };
      }
      return { isClosed: false, lateAfternoon: true, effectiveTime: cutoffTime.toDate() };
    }
  }
  return { isClosed: false, lateAfternoon: false, effectiveTime: nowDate };
}

const excludeLunchTime = (timeIn, timeOut) => {
  const LUNCH_START = 12; // 12 PM
  const LUNCH_END = 13;   // 1 PM

  if (!timeIn || !timeOut) return 0;

  let start = new Date(timeIn);
  let end = new Date(timeOut);

  const startHour = start.getHours() + start.getMinutes() / 60;
  const endHour = end.getHours() + end.getMinutes() / 60;

  if (endHour <= LUNCH_START || startHour >= LUNCH_END) {
    return (end - start) / (1000 * 60 * 60);
  }
  if (startHour <= LUNCH_START && endHour >= LUNCH_END) {
    return (end - start) / (1000 * 60 * 60) - 1;
  }
  if (startHour < LUNCH_START && endHour > LUNCH_START) {
    const lunchOverlap = Math.min(endHour, LUNCH_END) - LUNCH_START;
    return (end - start) / (1000 * 60 * 60) - lunchOverlap;
  }
  if (startHour < LUNCH_END && endHour > LUNCH_END) {
    const lunchOverlap = LUNCH_END - Math.max(startHour, LUNCH_START);
    return (end - start) / (1000 * 60 * 60) - lunchOverlap;
  }
  return (end - start) / (1000 * 60 * 60);
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
  if (req.session.user && req.session.user.role === 'admin') {
    return res.redirect('/admin/dashboard');
  }
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

    const today = moment().format('YYYY-MM-DD');
    let log = await prisma.dTRLog.findFirst({ where: { userId: user.userId, date: today } });

    if (action === 'time-in') {
      const now = new Date();
      const cutoffInfo = handleAfternoonCutoff(now);

      if (cutoffInfo.isClosed) {
        return res.json({ success: false, message: 'Afternoon log-in window closed. Contact your administrator.' });
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
        return res.json({ success: true, message: 'Welcome back! Afternoon session started.', userName: user.name, action: 'resume' });
      }

      log = await prisma.dTRLog.create({
        data: {
          user_id: user.id, userId: user.userId, userName: user.name,
          userType: user.role, date: today, timeIn: cutoffInfo.effectiveTime,
          late_afternoon: cutoffInfo.lateAfternoon,
          isActive: true, requiredHours: user.requiredHours || 8, status: 'in_progress'
        }
      });
      return res.json({ success: true, message: `Good ${timeOfDay()}! Time In recorded.`, userName: user.name, action: 'time-in' });
    }

    if (action === 'time-out') {
      if (!log || !log.timeIn) return res.json({ success: false, message: 'No Time In found for today.' });
      if (log.status === 'completed') return res.json({ success: false, message: 'Already timed out for today.' });
      if (!log.isActive) return res.json({ success: false, message: 'You are on break. Clock back in first.' });

      const now = new Date();
      let sessions = log.sessions || [];
      if (sessions.length === 0) {
        log.timeOut = now;
      } else {
        const last = sessions[sessions.length - 1];
        if (!last.timeOut) last.timeOut = now;
        log.sessions = sessions;
      }

      log.isActive = false;
      log.status = 'completed';

      // calculate
      const calcs = calculateTotals(log);

      log = await prisma.dTRLog.update({
        where: { id: log.id },
        data: {
          timeOut: log.timeOut,
          sessions: calcs.sessions,
          isActive: false,
          status: 'completed',
          totalHours: calcs.totalHours,
          overtimeHours: calcs.overtimeHours,
          undertimeHours: calcs.undertimeHours
        }
      });

      return res.json({ success: true, message: `Time Out recorded! Total: ${log.totalHours} hrs`, action: 'time-out' });
    }

    if (action === 'undo-timeout') {
      if (!log || log.status !== 'completed') return res.json({ success: false, message: 'Nothing to undo.' });
      let sessions = log.sessions || [];
      let lastOut = sessions.length > 0 ? sessions[sessions.length - 1].timeOut : log.timeOut;
      if (!lastOut) return res.json({ success: false, message: 'Nothing to undo.' });
      const minutesAgo = (Date.now() - new Date(lastOut)) / 60000;
      if (minutesAgo > 5) return res.json({ success: false, message: 'Undo window expired (5 minutes). Contact an admin.' });

      if (sessions.length > 0) { sessions[sessions.length - 1].timeOut = null; }
      else { log.timeOut = null; }
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
    const today = moment().format('YYYY-MM-DD');
    const logs = await prisma.dTRLog.findMany({
      where: { date: today },
      orderBy: { createdAt: 'desc' },
      take: 8
    });
    res.json({ logs });
  } catch (err) {
    res.json({ logs: [] });
  }
};

exports.getDTRPage = async (req, res) => {
  const { userId } = req.session.user;
  const today = moment().format('YYYY-MM-DD');
  const todayLog = await prisma.dTRLog.findFirst({ where: { userId, date: today } });
  res.render('dtr/index', { title: 'Time Record', user: req.session.user, todayLog, today });
};

exports.timeIn = async (req, res) => {
  const { userId, name, role } = req.session.user;
  const today = moment().format('YYYY-MM-DD');
  try {
    const userDoc = await prisma.user.findUnique({ where: { userId } });
    let existing = await prisma.dTRLog.findFirst({ where: { userId, date: today } });

    const now = new Date();
    const cutoffInfo = handleAfternoonCutoff(now);

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
  const today = moment().format('YYYY-MM-DD');
  try {
    let log = await prisma.dTRLog.findFirst({ where: { userId, date: today } });
    if (!log) { req.flash('error', 'No Time In found for today.'); return res.redirect('/dtr'); }
    if (log.status === 'completed') { req.flash('error', 'Already timed out today.'); return res.redirect('/dtr'); }
    if (!log.isActive) { req.flash('error', 'You are on break. Time In first.'); return res.redirect('/dtr'); }

    const now = new Date();
    let sessions = log.sessions || [];
    if (sessions.length === 0) { log.timeOut = now; }
    else { const last = sessions[sessions.length - 1]; if (!last.timeOut) last.timeOut = now; log.sessions = sessions; }

    const calcs = calculateTotals(log);

    await prisma.dTRLog.update({
      where: { id: log.id },
      data: {
        timeOut: log.timeOut,
        sessions: calcs.sessions,
        isActive: false,
        status: 'completed',
        totalHours: calcs.totalHours,
        overtimeHours: calcs.overtimeHours,
        undertimeHours: calcs.undertimeHours
      }
    });

    req.flash('success', `Time Out recorded! Total: ${calcs.totalHours} hrs`);
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
    const logs = await prisma.dTRLog.findMany({ where: query, orderBy: { date: 'desc' } });

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
    const logs = await prisma.dTRLog.findMany({ where: query, orderBy: { date: 'desc' } });

    res.render('admin/dtr-students', { title: 'Student DTR', logs, search, dateFrom, dateTo, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
};

exports.getSummary = async (req, res) => {
  try {
    const { userType = 'student', dateFrom, dateTo, userId } = req.query;
    const from = dateFrom || moment().startOf('month').format('YYYY-MM-DD');
    const to = dateTo || moment().format('YYYY-MM-DD');

    let query = { userType, date: { gte: from, lte: to } };
    if (userId) query.userId = userId;

    const logs = await prisma.dTRLog.findMany({ where: query, orderBy: { date: 'asc' } });
    const byEmployee = {};
    logs.forEach(log => {
      if (!byEmployee[log.userId]) {
        byEmployee[log.userId] = {
          userId: log.userId, userName: log.userName,
          days: 0, totalHours: 0, overtimeHours: 0, undertimeHours: 0,
          completedDays: 0, incompleteDays: 0, lateAfternoonCount: 0
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
    const log = await prisma.dTRLog.findUnique({ where: { id: req.params.id } });
    if (!log) return res.redirect('back');
    res.render('admin/dtr-edit', { title: 'Edit Log', log, user: req.session.user });
  } catch (err) {
    res.redirect('back');
  }
};

exports.postEditLog = async (req, res) => {
  try {
    const { timeIn, timeOut, notes, requiredHours, late_afternoon } = req.body;
    let log = await prisma.dTRLog.findUnique({ where: { id: req.params.id } });

    if (timeIn) log.timeIn = new Date(timeIn);
    if (timeOut) { log.timeOut = new Date(timeOut); log.isActive = false; log.status = 'completed'; }
    if (requiredHours) log.requiredHours = parseFloat(requiredHours);
    log.late_afternoon = late_afternoon === 'on';
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
    const dateFrom = from || moment().startOf('month').format('YYYY-MM-DD');
    const dateTo = to || moment().format('YYYY-MM-DD');

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
