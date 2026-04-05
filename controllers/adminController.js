const User = require('../models/User');
const DTRLog = require('../models/DTRLog');
const Payroll = require('../models/Payroll');
const CashAdvance = require('../models/CashAdvance');
const moment = require('moment');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// GET /admin/dashboard
exports.getDashboard = async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    const [totalMaintenance, totalStudents, totalLogs, totalPayrolls, todayLogs, todayLogsCount] = await Promise.all([
      User.countDocuments({ role: 'maintenance', isActive: true }),
      User.countDocuments({ role: 'student', isActive: true }),
      DTRLog.countDocuments(),
      Payroll.countDocuments(),
      DTRLog.find({ date: today }).sort({ createdAt: -1 }).limit(10),
      DTRLog.countDocuments({ date: today })
    ]);
    const recentPayrolls = await Payroll.find().sort({ generatedAt: -1 }).limit(5);

    const pendingAdvances = await CashAdvance.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: null, count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } }
    ]);
    const advanceStats = pendingAdvances.length > 0 ? pendingAdvances[0] : { count: 0, totalAmount: 0 };
    
    const totalAbsentToday = (totalMaintenance + totalStudents) - todayLogsCount;

    res.render('admin/dashboard', {
      title: 'Dashboard',
      stats: { totalMaintenance, totalStudents, totalLogs, totalPayrolls },
      extraStats: { totalAbsentToday: totalAbsentToday > 0 ? totalAbsentToday : 0, advances: advanceStats },
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

    // Handle Cash Advances
    const pendingAdvances = await CashAdvance.find({
      employeeId: userDoc._id,
      status: 'pending',
      targetPayrollDate: { $gte: startStr, $lte: endStr }
    });
    const cashAdvanceDeduction = pendingAdvances.reduce((sum, ca) => sum + ca.amount, 0);
    const netPay = totalSalary - cashAdvanceDeduction;

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
      cashAdvanceDeduction,
      netPay,
      cashAdvances: pendingAdvances.map(ca => ca._id),
      periodType,
      periodStart: new Date(periodStart),
      periodEnd:   new Date(periodEnd),
      generatedBy: req.session.user.name
    });

    const warnMsg = incompleteLogs > 0
      ? ` (Note: ${incompleteLogs} incomplete log(s) were excluded.)`
      : '';
    req.flash('success', `Payroll generated: Net Pay ₱${netPay.toFixed(2)} for ${userDoc.name} — ${logs.length} completed day(s)${warnMsg}`);
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
    const payroll = await Payroll.findById(req.params.id);
    if (!payroll) {
        req.flash('error', 'Payroll record not found.');
        return res.redirect('/admin/payroll');
    }

    payroll.paymentStatus = 'paid';
    payroll.paidAt = new Date();
    await payroll.save();

    // Mark associated advances as deducted
    if (payroll.cashAdvances && payroll.cashAdvances.length > 0) {
        await CashAdvance.updateMany(
            { _id: { $in: payroll.cashAdvances } },
            { $set: { status: 'deducted' } }
        );
    }

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

// GET /admin/payroll/export
exports.exportPayrollExcel = async (req, res) => {
  try {
    const { period, date } = req.query; // period=day|week|month, date=YYYY-MM-DD
    
    let query = {};
    if (period && date) {
      // Map 'day/week/month' to 'daily/weekly/monthly' for DB
      let dbPeriod = period;
      if (period === 'day') dbPeriod = 'daily';
      if (period === 'week') dbPeriod = 'weekly';
      if (period === 'month') dbPeriod = 'monthly';
      // Inverse map for moment logic
      let momentPeriod = period;
      if (period === 'daily') momentPeriod = 'day';
      if (period === 'weekly') momentPeriod = 'week';
      if (period === 'monthly') momentPeriod = 'month';

      query.periodType = dbPeriod;
      
      const targetDate = moment(date);
      let start, end;
      if (momentPeriod === 'day') {
        start = targetDate.startOf('day').toDate();
        end = targetDate.endOf('day').toDate();
      } else if (momentPeriod === 'week') {
        start = targetDate.startOf('isoWeek').toDate();
        end = targetDate.endOf('isoWeek').toDate();
      } else if (momentPeriod === 'month') {
        start = targetDate.startOf('month').toDate();
        end = targetDate.endOf('month').toDate();
      }
      if (start && end) {
        query.periodStart = { $gte: start, $lte: end };
      }
    }

    const payrolls = await Payroll.find(query).sort({ userType: 1, userName: 1 });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payroll');

    // Add Logo (Optional: requires path to exist or handle graceful skipping)
    let logoId;
    const logoPath = path.join(__dirname, '../public/images/logo.png');
    if (fs.existsSync(logoPath)) {
      logoId = workbook.addImage({
        filename: logoPath,
        extension: 'png',
      });
      worksheet.addImage(logoId, 'A1:B2');
    }
    
    // Row 1: Header
    worksheet.mergeCells('C1', 'H1');
    worksheet.getCell('C1').value = 'Cor Jesu College - Payroll System';
    worksheet.getCell('C1').font = { size: 16, bold: true };
    worksheet.getCell('C1').alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 30;

    // Row 2: Sub-Heading
    worksheet.mergeCells('C2', 'H2');
    worksheet.getCell('C2').value = `Payroll Period: ${period || 'All'} | Generated: ${date || moment().format('YYYY-MM-DD')}`;
    worksheet.getCell('C2').font = { size: 12, italic: true };
    worksheet.getCell('C2').alignment = { vertical: 'middle', horizontal: 'center' };

    worksheet.addRow([]); // Blank Row 3

    // Headers
    const headers = [
      'Name', 'Employee Type', 'Days/Hours Worked', 
      'Hourly Rate', 'Gross Pay', 'Cash Advance Deduction', 
      'Net Pay', 'Received By'
    ];
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
      cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
    });

    // Adjust Columns
    worksheet.columns = [
      { width: 25 }, { width: 15 }, { width: 15 },
      { width: 15 }, { width: 15 }, { width: 20 },
      { width: 15 }, { width: 30 }
    ];

    // Add Rows
    payrolls.forEach(p => {
      const row = worksheet.addRow([
        p.userName,
        p.userType.toUpperCase(),
        p.totalHoursWorked.toFixed(2),
        `₱${p.hourlyRate.toFixed(2)}`,
        `₱${p.totalSalary.toFixed(2)}`,
        `₱${(p.cashAdvanceDeduction || 0).toFixed(2)}`,
        `₱${(p.netPay || p.totalSalary).toFixed(2)}`,
        '' // Signature line
      ]);

      row.eachCell((cell) => {
        cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      // specific alignments
      row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
      row.getCell(8).alignment = { vertical: 'bottom', horizontal: 'center' }; // for writing signature
    });

    const filename = `payroll-${period || 'custom'}-${date || moment().format('YYYY-MM-DD')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to export to Excel.');
    res.redirect('/admin/payroll');
  }
};
