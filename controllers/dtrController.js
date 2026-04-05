const DTRLog = require('../models/DTRLog');
const User   = require('../models/User');
const moment = require('moment');

function handleAfternoonCutoff(nowDate) {
  const cutoffStr = process.env.AFTERNOON_CUTOFF || '13:30';
  const [cutoffH, cutoffM] = cutoffStr.split(':').map(Number);
  
  const mNow = moment(nowDate);
  const cutoffTime = moment(nowDate).hour(cutoffH).minute(cutoffM).second(0).millisecond(0);
  
  // Is this an "afternoon" login? (after 12:00 PM)
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

// ─────────────────────────────────────────
// PUBLIC KIOSK
// ─────────────────────────────────────────

exports.getKiosk = (req, res) => {
  if (req.session.user && req.session.user.role === 'admin') {
    return res.redirect('/admin/dashboard');
  }
  res.render('dtr/kiosk', { title: 'DTR Kiosk' });
};

exports.postKiosk = async (req, res) => {
  const { userId, password, action } = req.body;
  try {
    const user = await User.findOne({ userId: userId.toUpperCase(), isActive: true });
    if (!user || user.role === 'admin') {
      return res.json({ success: false, message: 'User ID not found.' });
    }
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.json({ success: false, message: 'Incorrect password. Please try again.' });
    }

    const today = moment().format('YYYY-MM-DD');
    let log = await DTRLog.findOne({ userId: user.userId, date: today });

    // ── TIME IN ──────────────────────────────
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
        // Re-entry after lunch break
        log.sessions.push({ timeIn: cutoffInfo.effectiveTime, timeOut: null, hours: 0 });
        if (cutoffInfo.lateAfternoon) log.late_afternoon = true;
        log.isActive = true;
        log.status   = 'in-progress';
        await log.save();
        return res.json({ success: true, message: 'Welcome back! Afternoon session started.',
          userName: user.name, userId: user.userId, userType: user.role, action: 'resume', todayLog: log });
      }
      log = await DTRLog.create({
        user: user._id, userId: user.userId, userName: user.name,
        userType: user.role, date: today, timeIn: cutoffInfo.effectiveTime,
        late_afternoon: cutoffInfo.lateAfternoon,
        isActive: true, requiredHours: user.requiredHours || 8, status: 'in-progress'
      });
      return res.json({ success: true, message: `Good ${timeOfDay()}! Time In recorded.`,
        userName: user.name, userId: user.userId, userType: user.role, action: 'time-in', todayLog: log });
    }

    // ── TIME OUT ─────────────────────────────
    if (action === 'time-out') {
      if (!log || !log.timeIn) {
        return res.json({ success: false, message: 'No Time In found for today.' });
      }
      if (log.status === 'completed') {
        return res.json({ success: false, message: 'Already timed out for today.' });
      }
      if (!log.isActive) {
        return res.json({ success: false, message: 'You are on break. Clock back in first.' });
      }
      const now = new Date();
      if (log.sessions.length === 0) { log.timeOut = now; }
      else { const last = log.sessions[log.sessions.length - 1]; if (!last.timeOut) last.timeOut = now; }
      log.isActive = false;
      log.status   = 'completed';
      await log.save();
      const otMsg = log.overtimeHours  > 0 ? `  +${log.overtimeHours.toFixed(2)} hrs OT` : '';
      const utMsg = log.undertimeHours > 0 ? `  −${log.undertimeHours.toFixed(2)} hrs UT` : '';
      return res.json({ success: true,
        message: `Time Out recorded! Total: ${log.totalHours.toFixed(2)} hrs${otMsg}${utMsg}`,
        userName: user.name, userId: user.userId, userType: user.role,
        totalHours: log.totalHours.toFixed(2), overtimeHours: log.overtimeHours.toFixed(2),
        undertimeHours: log.undertimeHours.toFixed(2), action: 'time-out', todayLog: log });
    }

    // ── UNDO LAST TIMEOUT (within 5 min) ────
    if (action === 'undo-timeout') {
      if (!log || log.status !== 'completed') {
        return res.json({ success: false, message: 'Nothing to undo.' });
      }
      let lastOut = log.sessions.length > 0 ? log.sessions[log.sessions.length - 1].timeOut : log.timeOut;
      if (!lastOut) return res.json({ success: false, message: 'Nothing to undo.' });
      const minutesAgo = (Date.now() - new Date(lastOut)) / 60000;
      if (minutesAgo > 5) {
        return res.json({ success: false, message: 'Undo window expired (5 minutes). Contact an admin.' });
      }
      if (log.sessions.length > 0) { log.sessions[log.sessions.length - 1].timeOut = null; }
      else { log.timeOut = null; }
      log.isActive = true;
      log.status   = 'in-progress';
      await log.save();
      return res.json({ success: true, message: 'Time Out undone! You are clocked back in.',
        userName: user.name, userId: user.userId, userType: user.role, action: 'undo', todayLog: log });
    }

    return res.json({ success: false, message: 'Invalid action.' });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, message: 'Server error. Please try again.' });
  }
};

exports.getRecentLogs = async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    const logs  = await DTRLog.find({ date: today }).sort({ createdAt: -1 }).limit(8);
    res.json({ logs });
  } catch (err) {
    res.json({ logs: [] });
  }
};

// ─────────────────────────────────────────
// SESSION-BASED DTR (logged-in staff)
// ─────────────────────────────────────────

exports.getDTRPage = async (req, res) => {
  const { userId } = req.session.user;
  const today = moment().format('YYYY-MM-DD');
  const todayLog = await DTRLog.findOne({ userId, date: today });
  res.render('dtr/index', { title: 'Time Record', user: req.session.user, todayLog, today });
};

exports.timeIn = async (req, res) => {
  const { userId, name, role } = req.session.user;
  const today = moment().format('YYYY-MM-DD');
  try {
    const userDoc  = await User.findOne({ userId });
    let   existing = await DTRLog.findOne({ userId, date: today });
    
    const now = new Date();
    const cutoffInfo = handleAfternoonCutoff(now);
    if (cutoffInfo.isClosed) {
      req.flash('error', 'Afternoon log-in window closed. Contact your administrator.');
      return res.redirect('/dtr');
    }

    if (existing) {
      if (existing.status === 'completed') { req.flash('error', 'Shift already completed today.'); return res.redirect('/dtr'); }
      if (existing.isActive)               { req.flash('error', 'Already clocked in.');            return res.redirect('/dtr'); }
      existing.sessions.push({ timeIn: cutoffInfo.effectiveTime, timeOut: null, hours: 0 });
      if (cutoffInfo.lateAfternoon) existing.late_afternoon = true;
      existing.isActive = true;
      existing.status   = 'in-progress';
      await existing.save();
      req.flash('success', 'Welcome back! Afternoon session started.');
      return res.redirect('/dtr');
    }
    await DTRLog.create({
      user: userDoc._id, userId, userName: name, userType: role, date: today,
      timeIn: cutoffInfo.effectiveTime, late_afternoon: cutoffInfo.lateAfternoon,
      isActive: true, requiredHours: userDoc.requiredHours || 8, status: 'in-progress'
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
    const log = await DTRLog.findOne({ userId, date: today });
    if (!log)                       { req.flash('error', 'No Time In found for today.');     return res.redirect('/dtr'); }
    if (log.status === 'completed') { req.flash('error', 'Already timed out today.');        return res.redirect('/dtr'); }
    if (!log.isActive)              { req.flash('error', 'You are on break. Time In first.'); return res.redirect('/dtr'); }
    const now = new Date();
    if (log.sessions.length === 0) { log.timeOut = now; }
    else { const last = log.sessions[log.sessions.length - 1]; if (!last.timeOut) last.timeOut = now; }
    log.isActive = false;
    log.status   = 'completed';
    await log.save();
    const otMsg = log.overtimeHours  > 0 ? ` | OT: +${log.overtimeHours.toFixed(2)} hrs` : '';
    const utMsg = log.undertimeHours > 0 ? ` | UT: −${log.undertimeHours.toFixed(2)} hrs` : '';
    req.flash('success', `Time Out recorded! Total: ${log.totalHours.toFixed(2)} hrs${otMsg}${utMsg}`);
    res.redirect('/dtr');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error recording time out.');
    res.redirect('/dtr');
  }
};

// ─────────────────────────────────────────
// ADMIN — DTR VIEWS
// ─────────────────────────────────────────

exports.getMaintenanceDTR = async (req, res) => {
  try {
    const { search, dateFrom, dateTo } = req.query;
    let query = { userType: 'maintenance' };
    if (search) query.$or = [{ userName: { $regex: search, $options: 'i' } }, { userId: { $regex: search, $options: 'i' } }];
    if (dateFrom || dateTo) {
      query.date = {};
      if (dateFrom) query.date.$gte = dateFrom;
      if (dateTo)   query.date.$lte = dateTo;
    }
    const logs = await DTRLog.find(query).sort({ date: -1, createdAt: -1 });
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
    if (search) query.$or = [{ userName: { $regex: search, $options: 'i' } }, { userId: { $regex: search, $options: 'i' } }];
    if (dateFrom || dateTo) {
      query.date = {};
      if (dateFrom) query.date.$gte = dateFrom;
      if (dateTo)   query.date.$lte = dateTo;
    }
    const logs = await DTRLog.find(query).sort({ date: -1, createdAt: -1 });
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
    const to   = dateTo   || moment().format('YYYY-MM-DD');
    let matchQuery = { userType, date: { $gte: from, $lte: to } };
    if (userId) matchQuery.userId = userId;
    const logs = await DTRLog.find(matchQuery).sort({ userId: 1, date: 1 });
    const byEmployee = {};
    logs.forEach(log => {
      if (!byEmployee[log.userId]) {
        byEmployee[log.userId] = { userId: log.userId, userName: log.userName,
          days: 0, totalHours: 0, overtimeHours: 0, undertimeHours: 0,
          completedDays: 0, incompleteDays: 0, lateAfternoonCount: 0 };
      }
      const e = byEmployee[log.userId];
      e.days++;
      e.totalHours     += log.totalHours     || 0;
      e.overtimeHours  += log.overtimeHours  || 0;
      e.undertimeHours += log.undertimeHours || 0;
      if (log.status === 'completed') e.completedDays++;
      else e.incompleteDays++;
      if (log.late_afternoon) e.lateAfternoonCount++;
    });
    const summaries = Object.values(byEmployee).map(e => ({
      ...e,
      totalHours:     Math.round(e.totalHours     * 100) / 100,
      overtimeHours:  Math.round(e.overtimeHours  * 100) / 100,
      undertimeHours: Math.round(e.undertimeHours * 100) / 100
    }));
    const users = await User.find({ role: userType, isActive: true }).sort({ name: 1 });
    res.render('admin/dtr-summary', { title: 'DTR Summary', summaries, userType, dateFrom: from, dateTo: to, userId, users, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
};

exports.getEditLog = async (req, res) => {
  try {
    const log = await DTRLog.findById(req.params.id);
    if (!log) return res.redirect('back');
    res.render('admin/dtr-edit', { title: 'Edit Log', log, user: req.session.user });
  } catch (err) {
    res.redirect('back');
  }
};

exports.postEditLog = async (req, res) => {
  try {
    const { timeIn, timeOut, notes, requiredHours, late_afternoon } = req.body;
    const log = await DTRLog.findById(req.params.id);
    if (timeIn)  log.timeIn  = new Date(timeIn);
    if (timeOut) { log.timeOut = new Date(timeOut); log.isActive = false; log.status = 'completed'; }
    if (requiredHours) log.requiredHours = parseFloat(requiredHours);
    log.late_afternoon = late_afternoon === 'on';
    log.notes = notes;
    await log.save();
    req.flash('success', 'Log updated successfully.');
    res.redirect(log.userType === 'maintenance' ? '/admin/dtr/maintenance' : '/admin/dtr/students');
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
};

exports.deleteLog = async (req, res) => {
  try {
    const log = await DTRLog.findByIdAndDelete(req.params.id);
    req.flash('success', 'Log deleted.');
    res.redirect(log && log.userType === 'maintenance' ? '/admin/dtr/maintenance' : '/admin/dtr/students');
  } catch (err) {
    res.redirect('back');
  }
};

exports.getAbsenceSummary = async (req, res) => {
  try {
    const { type = 'all', from, to } = req.query;
    const dateFrom = from || moment().startOf('month').format('YYYY-MM-DD');
    const dateTo   = to   || moment().format('YYYY-MM-DD');

    // Find users
    let userQuery = { role: { $ne: 'admin' }, isActive: true };
    if (type !== 'all') {
      userQuery.role = type;
    }
    const users = await User.find(userQuery);

    // Number of days in interval
    const startObj = moment(dateFrom);
    const endObj = moment(dateTo);
    let scheduledDays = 0;
    if (endObj.diff(startObj, 'days') >= 0) {
      scheduledDays = endObj.diff(startObj, 'days') + 1;
    }

    const reports = await Promise.all(users.map(async (u) => {
      // Distinct dates worked for this user
      const logs = await DTRLog.distinct('date', {
        userId: u.userId,
        date: { $gte: dateFrom, $lte: dateTo },
        status: 'completed'
      });
      const daysWorked = logs.length;
      let absentDays = scheduledDays - daysWorked;
      if (absentDays < 0) absentDays = 0;
      let absenceRate = scheduledDays > 0 ? (absentDays / scheduledDays) * 100 : 0;

      return {
        name: u.name,
        userId: u.userId,
        role: u.role,
        scheduledDays,
        absentDays,
        absenceRate
      };
    }));

    // Sort by name
    reports.sort((a, b) => a.name.localeCompare(b.name));

    res.render('admin/absence-summary', {
      title: 'Absence Summary Report',
      reports,
      type,
      dateFrom,
      dateTo,
      user: req.session.user
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
};

function timeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}
