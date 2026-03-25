const User = require('../models/User');
const DTRLog = require('../models/DTRLog');
const Payroll = require('../models/Payroll');
const moment = require('moment');

// GET /admin/dashboard
exports.getDashboard = async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    const [totalMaintenance, totalStudents, totalLogs, totalPayrolls, todayLogs] = await Promise.all([
      User.countDocuments({ role: 'maintenance', isActive: true }),
      User.countDocuments({ role: 'student', isActive: true }),
      DTRLog.countDocuments(),
      Payroll.countDocuments(),
      DTRLog.find({ date: today }).sort({ createdAt: -1 }).limit(10)
    ]);
    const recentPayrolls = await Payroll.find().sort({ generatedAt: -1 }).limit(5);
    res.render('admin/dashboard', {
      title: 'Dashboard',
      stats: { totalMaintenance, totalStudents, totalLogs, totalPayrolls },
      todayLogs,
      recentPayrolls,
      today,
      user: req.session.user
    });
  } catch (err) {
    console.error(err);
    res.render('admin/dashboard', { title: 'Dashboard', stats: {}, todayLogs: [], recentPayrolls: [], user: req.session.user });
  }
};

// GET /admin/users
exports.getUsers = async (req, res) => {
  try {
    const { role, search } = req.query;
    let query = { role: { $ne: 'admin' } };
    if (role) query.role = role;
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { userId: { $regex: search, $options: 'i' } }
    ];
    const users = await User.find(query).sort({ createdAt: -1 });
    res.render('admin/users', { title: 'Users', users, role, search, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
};

// GET /admin/users/new
exports.getNewUser = (req, res) => {
  res.render('admin/user-form', { title: 'Add User', editUser: null, user: req.session.user, error: req.flash('error') });
};

// POST /admin/users/new
exports.postNewUser = async (req, res) => {
  try {
    const { userId, name, email, password, role, department, hourlyRate, requiredHours } = req.body;
    const existing = await User.findOne({ userId: userId.toUpperCase() });
    if (existing) {
      req.flash('error', 'User ID already exists.');
      return res.redirect('/admin/users/new');
    }
    await User.create({ userId, name, email, password, role, department, hourlyRate: hourlyRate || 0, requiredHours: requiredHours || 8 });
    req.flash('success', 'User created successfully.');
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error creating user.');
    res.redirect('/admin/users/new');
  }
};

// GET /admin/users/edit/:id
exports.getEditUser = async (req, res) => {
  try {
    const editUser = await User.findById(req.params.id);
    res.render('admin/user-form', { title: 'Edit User', editUser, user: req.session.user, error: req.flash('error') });
  } catch (err) {
    res.redirect('/admin/users');
  }
};

// POST /admin/users/edit/:id
exports.postEditUser = async (req, res) => {
  try {
    const { name, email, role, department, hourlyRate, requiredHours, isActive, password } = req.body;
    const user = await User.findById(req.params.id);
    user.name = name;
    user.email = email;
    user.role = role;
    user.department = department;
    user.hourlyRate = hourlyRate || 0;
    user.requiredHours = requiredHours || 8;
    user.isActive = isActive === 'on';
    if (password && password.trim()) user.password = password;
    await user.save();
    req.flash('success', 'User updated.');
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    res.redirect('back');
  }
};

// POST /admin/users/delete/:id
exports.deleteUser = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    req.flash('success', 'User deleted.');
    res.redirect('/admin/users');
  } catch (err) {
    res.redirect('/admin/users');
  }
};

// GET /admin/payroll
exports.getPayroll = async (req, res) => {
  try {
    const { userType, status } = req.query;
    let query = {};
    if (userType) query.userType = userType;
    if (status) query.paymentStatus = status;
    const payrolls = await Payroll.find(query).sort({ generatedAt: -1 });
    res.render('admin/payroll', { title: 'Payroll', payrolls, userType, status, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
};

// GET /admin/payroll/generate
exports.getGeneratePayroll = async (req, res) => {
  const users = await User.find({ role: { $ne: 'admin' }, isActive: true });
  res.render('admin/payroll-generate', { title: 'Generate Payroll', users, user: req.session.user, error: req.flash('error') });
};

// POST /admin/payroll/generate
exports.postGeneratePayroll = async (req, res) => {
  try {
    const { userId, periodType, periodStart, periodEnd } = req.body;
    const userDoc = await User.findById(userId);
    if (!userDoc) {
      req.flash('error', 'User not found.');
      return res.redirect('/admin/payroll/generate');
    }

    const startStr = moment(periodStart).format('YYYY-MM-DD');
    const endStr = moment(periodEnd).format('YYYY-MM-DD');

    const logs = await DTRLog.find({
      userId: userDoc.userId,
      date: { $gte: startStr, $lte: endStr },
      status: 'completed',
      totalHours: { $gt: 0 }
    });

    const totalHours   = logs.reduce((sum, l) => sum + (l.totalHours     || 0), 0);
    const totalOT      = logs.reduce((sum, l) => sum + (l.overtimeHours  || 0), 0);
    const totalUT      = logs.reduce((sum, l) => sum + (l.undertimeHours || 0), 0);
    const totalSalary  = Math.round(totalHours * userDoc.hourlyRate * 100) / 100;

    // Check for any in-progress logs in the period (warn admin)
    const incompleteLogs = await DTRLog.countDocuments({
      userId: userDoc.userId,
      date: { $gte: startStr, $lte: endStr },
      status: { $in: ['in-progress', 'on-break'] }
    });

    await Payroll.create({
      user: userDoc._id,
      userId: userDoc.userId,
      userName: userDoc.name,
      userType: userDoc.role,
      hourlyRate: userDoc.hourlyRate,
      totalHoursWorked:  Math.round(totalHours * 100) / 100,
      totalOvertimeHours: Math.round(totalOT   * 100) / 100,
      totalUndertimeHours: Math.round(totalUT  * 100) / 100,
      totalSalary,
      periodType,
      periodStart: new Date(periodStart),
      periodEnd:   new Date(periodEnd),
      generatedBy: req.session.user.name
    });

    const warnMsg = incompleteLogs > 0
      ? ` (Note: ${incompleteLogs} incomplete log(s) were excluded.)`
      : '';
    req.flash('success', `Payroll generated: ₱${totalSalary.toFixed(2)} for ${userDoc.name} — ${logs.length} completed day(s)${warnMsg}`);
    res.redirect('/admin/payroll');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error generating payroll.');
    res.redirect('/admin/payroll/generate');
  }
};

// POST /admin/payroll/pay/:id
exports.markPaid = async (req, res) => {
  try {
    await Payroll.findByIdAndUpdate(req.params.id, { paymentStatus: 'paid', paidAt: new Date() });
    req.flash('success', 'Payroll marked as paid.');
    res.redirect('/admin/payroll');
  } catch (err) {
    res.redirect('/admin/payroll');
  }
};

// POST /admin/payroll/delete/:id
exports.deletePayroll = async (req, res) => {
  try {
    await Payroll.findByIdAndDelete(req.params.id);
    req.flash('success', 'Payroll record deleted.');
    res.redirect('/admin/payroll');
  } catch (err) {
    res.redirect('/admin/payroll');
  }
};
