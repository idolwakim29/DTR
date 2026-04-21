const prisma = require('../prismaClient');
const bcrypt = require('bcryptjs');
const moment = require('moment');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// GET /admin/dashboard
exports.getDashboard = async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    const [totalMaintenance, totalStudents, totalLogs, totalPayrolls, todayLogs, todayLogsCount] = await Promise.all([
      prisma.user.count({ where: { role: 'maintenance', isActive: true } }),
      prisma.user.count({ where: { role: 'student', isActive: true } }),
      prisma.dTRLog.count(),
      prisma.payroll.count(),
      prisma.dTRLog.findMany({ where: { date: today }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.dTRLog.count({ where: { date: today } })
    ]);
    const recentPayrolls = await prisma.payroll.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });

    const pendingAdvances = await prisma.cashAdvance.aggregate({
      _count: { id: true },
      _sum: { amount: true },
      where: { status: 'pending' }
    });
    const advanceStats = { count: pendingAdvances._count.id || 0, totalAmount: pendingAdvances._sum.amount || 0 };

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
    let mappedQuery = { role: { not: 'admin' } };
    if (role) mappedQuery.role = role;
    if (search) {
      mappedQuery.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { userId: { contains: search, mode: 'insensitive' } }
      ];
    }
    const usersDocs = await prisma.user.findMany({ where: mappedQuery, orderBy: { createdAt: 'desc' } });
    const users = usersDocs.map(u => ({ ...u, _id: u.id })); // Added _id for EJS compatibility
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
    const existing = await prisma.user.findUnique({ where: { userId: userId.toUpperCase() } });
    if (existing) {
      req.flash('error', 'User ID already exists.');
      return res.redirect('/admin/users/new');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.create({ data: { userId: userId.toUpperCase(), name, email, password: hashedPassword, role, department, hourlyRate: parseFloat(hourlyRate) || 0, requiredHours: parseFloat(requiredHours) || 8 } });

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
    const userDoc = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!userDoc) return res.redirect('/admin/users');
    const editUser = { ...userDoc, _id: userDoc.id };
    res.render('admin/user-form', { title: 'Edit User', editUser, user: req.session.user, error: req.flash('error') });
  } catch (err) {
    res.redirect('/admin/users');
  }
};

// POST /admin/users/edit/:id
exports.postEditUser = async (req, res) => {
  try {
    const { name, email, role, department, hourlyRate, requiredHours, isActive, password } = req.body;
    const isActiveBool = isActive === 'on';
    
    const updateData = {
      name,
      email,
      role,
      department,
      hourlyRate: parseFloat(hourlyRate) || 0,
      requiredHours: parseFloat(requiredHours) || 8,
      isActive: isActiveBool
    };

    if (password && password.trim()) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: updateData
    });
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
    await prisma.user.delete({ where: { id: req.params.id } });
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
    if (status) query.isPaid = status === 'paid';
    const payrollsDocs = await prisma.payroll.findMany({ where: query, orderBy: { createdAt: 'desc' } });
    const payrolls = payrollsDocs.map(p => ({ ...p, _id: p.id }));
    res.render('admin/payroll', { title: 'Payroll', payrolls, userType, status, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
};

// GET /admin/payroll/generate
exports.getGeneratePayroll = async (req, res) => {
  const usersDocs = await prisma.user.findMany({ where: { role: { not: 'admin' }, isActive: true } });
  const users = usersDocs.map(u => ({ ...u, _id: u.id }));
  res.render('admin/payroll-generate', { title: 'Generate Payroll', users, user: req.session.user, error: req.flash('error') });
};

// POST /admin/payroll/generate
exports.postGeneratePayroll = async (req, res) => {
  try {
    const { userId, periodType, periodStart, periodEnd } = req.body;
    const userDoc = await prisma.user.findUnique({ where: { id: userId } });
    if (!userDoc) {
      req.flash('error', 'User not found.');
      return res.redirect('/admin/payroll/generate');
    }

    const startStr = moment(periodStart).format('YYYY-MM-DD');
    const endStr = moment(periodEnd).format('YYYY-MM-DD');

    const logs = await prisma.dTRLog.findMany({
      where: {
        userId: userDoc.userId,
        date: { gte: startStr, lte: endStr },
        status: 'completed',
        totalHours: { gt: 0 }
      }
    });

    const totalHours = logs.reduce((sum, l) => sum + (l.totalHours || 0), 0);
    const totalOT = logs.reduce((sum, l) => sum + (l.overtimeHours || 0), 0);
    const totalUT = logs.reduce((sum, l) => sum + (l.undertimeHours || 0), 0);
    const totalSalary = Math.round(totalHours * userDoc.hourlyRate * 100) / 100;

    // Check for any in-progress logs in the period (warn admin)
    const incompleteLogs = await prisma.dTRLog.count({
      where: {
        userId: userDoc.userId,
        date: { gte: startStr, lte: endStr },
        status: { in: ['in_progress', 'on_break'] }
      }
    });

    // Handle Cash Advances
    const pendingAdvances = await prisma.cashAdvance.findMany({
      where: {
        employeeId: userDoc.id,
        status: 'pending',
        targetPayrollDate: { gte: startStr, lte: endStr }
      }
    });
    const cashAdvanceDeduction = pendingAdvances.reduce((sum, ca) => sum + ca.amount, 0);
    const netPay = totalSalary - cashAdvanceDeduction;

    await prisma.payroll.create({
      data: {
        userId: userDoc.userId,
        userName: userDoc.name,
        userType: userDoc.role,
        periodType: periodType,
        periodStart: startStr,
        periodEnd: endStr,
        totalHours: Math.round(totalHours * 100) / 100,
        overtimeHours: Math.round(totalOT * 100) / 100,
        undertimeHours: Math.round(totalUT * 100) / 100,
        grossPay: totalSalary,
        deductions: cashAdvanceDeduction,
        netPay,
        baseRate: userDoc.hourlyRate
      }
    });
    // Mark advances as deducted locally? The original code didn't mark them instantly, it just included them. Wait, CashAdvances need to be marked deducted when payroll is paid!


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

    const payroll = await prisma.payroll.findUnique({ where: { id: req.params.id } });
    if (!payroll) {
      req.flash('error', 'Payroll record not found.');
      return res.redirect('/admin/payroll');
    }
    await prisma.payroll.update({
      where: { id: req.params.id },
      data: { isPaid: true, paidOn: new Date() }
    });


    // Mark associated advances as deducted
    const user = await prisma.user.findUnique({ where: { userId: payroll.userId } });
    if (user) {
      await prisma.cashAdvance.updateMany({
        where: { employeeId: user.id, status: 'pending' },
        data: { status: 'deducted', deductedOn: new Date() }
      });
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
    await prisma.payroll.delete({ where: { id: req.params.id } });
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
        query.periodStart = { gte: startStr, lte: endStr }; // Assuming strings for stability as seen in generate
      }
    }

    const payrolls = await prisma.payroll.findMany({ orderBy: [{ userName: 'asc' }] });

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
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
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
        ''.toUpperCase(),
        p.totalHours.toFixed(2),
        `₱${p.hourlyRate.toFixed(2)}`,
        `₱${p.grossPay.toFixed(2)}`,
        `₱${(p.deductions || 0).toFixed(2)}`,
        `₱${(p.netPay || p.grossPay).toFixed(2)}`,
        '' // Signature line
      ]);

      row.eachCell((cell) => {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
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
