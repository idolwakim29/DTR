const prisma = require('../prismaClient');
const bcrypt = require('bcryptjs');
const moment = require('moment-timezone');
const PH_TZ = 'Asia/Manila';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// GET /admin/dashboard
exports.getDashboard = async (req, res) => {
  try {
    const today = moment().tz(PH_TZ).format('YYYY-MM-DD');
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
    res.render('admin/dashboard', {
      title: 'Dashboard',
      stats: { totalMaintenance: 0, totalStudents: 0, totalLogs: 0, totalPayrolls: 0 },
      extraStats: { totalAbsentToday: 0, advances: { count: 0, totalAmount: 0 } },
      todayLogs: [],
      recentPayrolls: [],
      today: moment().tz(PH_TZ).format('YYYY-MM-DD'),
      user: req.session.user
    });
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
  res.render('admin/user-form', { title: 'Add User', editUser: null, user: req.session.user });
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
    res.render('admin/user-form', { title: 'Edit User', editUser, user: req.session.user });
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
    console.error('deleteUser error:', err);
    req.flash('error', 'Could not delete user. They may have linked records.');
    res.redirect('/admin/users');
  }
};

// GET /admin/payroll
exports.getPayroll = async (req, res) => {
  try {
    const { userType, status, search } = req.query;

    let query = {};
    if (userType) query.userType = userType;
    if (status)   query.isPaid = status === 'paid';
    if (search) {
      query.OR = [
        { userName: { contains: search, mode: 'insensitive' } },
        { userId:   { contains: search, mode: 'insensitive' } }
      ];
    }
    const payrollsDocs = await prisma.payroll.findMany({ where: query, orderBy: { createdAt: 'desc' } });
    const payrolls = payrollsDocs.map(p => ({ ...p, _id: p.id }));
    res.render('admin/payroll', { title: 'Payroll', payrolls, userType, status, search: search || '', user: req.session.user });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
};

// GET /admin/payroll/generate
exports.getGeneratePayroll = async (req, res) => {
  try {
    const usersDocs = await prisma.user.findMany({ where: { role: { not: 'admin' }, isActive: true } });
    const users = usersDocs.map(u => ({ ...u, _id: u.id }));
    res.render('admin/payroll-generate', { title: 'Generate Payroll', users, user: req.session.user });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load payroll generation page.');
    res.redirect('/admin/payroll');
  }
};

// POST /admin/payroll/generate
exports.postGeneratePayroll = async (req, res) => {
  try {
    const { userId, periodType, periodStart, periodEnd } = req.body;
    
    let targetUsers = [];
    if (userId === 'BATCH_STUDENT') {
      targetUsers = await prisma.user.findMany({ where: { role: 'student', isActive: true } });
    } else if (userId === 'BATCH_MAINTENANCE') {
      targetUsers = await prisma.user.findMany({ where: { role: 'maintenance', isActive: true } });
    } else {
      const u = await prisma.user.findUnique({ where: { id: userId } });
      if (u && u.role !== 'admin' && u.isActive) targetUsers.push(u);
    }

    if (targetUsers.length === 0) {
      req.flash('error', 'No qualifying users found for payroll generation.');
      return res.redirect('/admin/payroll/generate');
    }

    const startStr = moment.tz(periodStart, PH_TZ).format('YYYY-MM-DD');
    const endStr   = moment.tz(periodEnd,   PH_TZ).format('YYYY-MM-DD');

    let processedCount = 0;
    let skippedCount = 0;
    let messages = []; // Used to collect errors if single user mode

    for (const userDoc of targetUsers) {
      // Prevent identical overlapping payroll generation
      const existingPayroll = await prisma.payroll.findFirst({
        where: {
          userId: userDoc.userId,
          periodStart: startStr,
          periodEnd: endStr
        }
      });

      if (existingPayroll) {
        skippedCount++;
        messages.push(`Record already exists for ${userDoc.name}.`);
        continue;
      }

      const logs = await prisma.dTRLog.findMany({
        where: {
          userId: userDoc.userId,
          date: { gte: startStr, lte: endStr },
          status: 'completed',
          totalHours: { gt: 0 }
        }
      });

      // even if no logs, we might generate a 0-hour payroll if they have cash advances (though unlikely). Let's skip if 0 logs and 0 advances? Let's just generate anyway for completeness, or only if logs>0
      if (logs.length === 0) {
        skippedCount++;
        messages.push(`No completed DTR logs found for ${userDoc.name}.`);
        continue;
      }

      const totalHours = logs.reduce((sum, l) => sum + (l.totalHours || 0), 0);
      const totalOT = logs.reduce((sum, l) => sum + (l.overtimeHours || 0), 0);
      const totalUT = logs.reduce((sum, l) => sum + (l.undertimeHours || 0), 0);
      const totalSalary = Math.round(totalHours * userDoc.hourlyRate * 100) / 100;

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
      processedCount++;
    }

    if (processedCount === 0) {
      // If we did a batch and 0 generated, or 1 and 0 generated
      req.flash('error', `Failed to generate payroll. ${skippedCount} skipped. ` + (targetUsers.length === 1 ? messages.join(' ') : ''));
      res.redirect('/admin/payroll/generate');
    } else {
      let msg = `Payroll generated successfully: ${processedCount} processed.`;
      if (skippedCount > 0) msg += ` (${skippedCount} skipped)`;
      req.flash('success', msg);
      res.redirect('/admin/payroll');
    }

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


    // Mark only advances within this payroll period as deducted
    const user = await prisma.user.findUnique({ where: { userId: payroll.userId } });
    if (user) {
      await prisma.cashAdvance.updateMany({
        where: {
          employeeId: user.id,
          status: 'pending',
          targetPayrollDate: { gte: payroll.periodStart, lte: payroll.periodEnd }
        },
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
    const payroll = await prisma.payroll.findUnique({ where: { id: req.params.id } });
    if (!payroll) {
      req.flash('error', 'Payroll record not found.');
      return res.redirect('/admin/payroll');
    }

    // Revert associated cash advances if this payroll was already marked paid
    if (payroll.isPaid) {
      const user = await prisma.user.findUnique({ where: { userId: payroll.userId } });
      if (user) {
        await prisma.cashAdvance.updateMany({
          where: {
            employeeId: user.id,
            status: 'deducted',
            targetPayrollDate: { gte: payroll.periodStart, lte: payroll.periodEnd }
          },
          data: { status: 'pending', deductedOn: null }
        });
      }
    }

    await prisma.payroll.delete({ where: { id: req.params.id } });
    req.flash('success', 'Payroll record deleted successfully.');
    res.redirect('/admin/payroll');
  } catch (err) {
    req.flash('error', 'Error deleting payroll record.');
    res.redirect('/admin/payroll');
  }
};

// GET /admin/payroll/export
exports.exportPayrollExcel = async (req, res) => {
  try {
    const { period, date } = req.query; // period=day|week|month, date=YYYY-MM-DD

    let query = {};
    let startStr, endStr;

    if (period && date) {
      // Build date range as YYYY-MM-DD strings
      const targetDate = moment(date);
      let dbPeriod = period;
      if (period === 'day')   dbPeriod = 'daily';
      if (period === 'week')  dbPeriod = 'weekly';
      if (period === 'month') dbPeriod = 'monthly';

      if (dbPeriod === 'daily') {
        startStr = targetDate.format('YYYY-MM-DD');
        endStr   = targetDate.format('YYYY-MM-DD');
      } else if (dbPeriod === 'weekly') {
        startStr = moment(date).startOf('isoWeek').format('YYYY-MM-DD');
        endStr   = moment(date).endOf('isoWeek').format('YYYY-MM-DD');
      } else if (dbPeriod === 'monthly') {
        startStr = moment(date).startOf('month').format('YYYY-MM-DD');
        endStr   = moment(date).endOf('month').format('YYYY-MM-DD');
      }
      if (startStr && endStr) {
        // Find ANY payroll that overlaps cleanly with the target window
        query.periodStart = { lte: endStr };
        query.periodEnd   = { gte: startStr };
      }
    }

    const payrolls = await prisma.payroll.findMany({ where: query, orderBy: [{ userName: 'asc' }] });

    // Fetch all users to get department & requiredHours
    const users = await prisma.user.findMany({ where: { role: { not: 'admin' } } });
    const userMap = {};
    users.forEach(u => { userMap[u.userId] = u; });

    // For each payroll, count DTR logs (days worked) in the period
    const daysWorkedMap = {};
    await Promise.all(payrolls.map(async (p) => {
      const s = p.periodStart;
      const e = p.periodEnd;
      const count = await prisma.dTRLog.count({
        where: { userId: p.userId, date: { gte: s, lte: e }, status: 'completed' }
      });
      daysWorkedMap[p.id] = count;
    }));

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payroll');

    // Column widths — 11 columns
    worksheet.columns = [
      { width: 28 }, // Name
      { width: 20 }, // Area/Dept
      { width: 14 }, // Daily Rate
      { width: 14 }, // Hourly Rate
      { width: 14 }, // Days Worked
      { width: 14 }, // Hours Worked
      { width: 16 }, // Gross Pay
      { width: 14 }, // SSS
      { width: 14 }, // PhilHealth
      { width: 16 }, // Net Pay
      { width: 30 }, // Signature
    ];

    // ── Logo ──
    const logoPath = path.join(__dirname, '../public/images/logo.png');
    if (fs.existsSync(logoPath)) {
      const logoId = workbook.addImage({ filename: logoPath, extension: 'png' });
      worksheet.addImage(logoId, 'A1:B2');
    }

    // ── Row 1: Title ──
    worksheet.mergeCells('C1:K1');
    worksheet.getCell('C1').value = 'Cor Jesu College – Payroll System';
    worksheet.getCell('C1').font = { size: 16, bold: true };
    worksheet.getCell('C1').alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 32;

    // ── Row 2: Sub-heading ──
    worksheet.mergeCells('C2:K2');
    const periodLabel = period ? period.charAt(0).toUpperCase() + period.slice(1) : 'All';
    worksheet.getCell('C2').value =
      `Period: ${periodLabel}  |  ${startStr || '—'} to ${endStr || '—'}  |  Generated: ${moment().tz(PH_TZ).format('YYYY-MM-DD')}`;
    worksheet.getCell('C2').font = { size: 11, italic: true };
    worksheet.getCell('C2').alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(2).height = 22;

    worksheet.addRow([]); // blank row 3

    // ── Row 4: Column Headers ──
    const headers = [
      'Name', 'Area / Dept.', 'Daily Rate', 'Hourly Rate',
      'Days Worked', 'Hours Worked', 'Gross Pay',
      'SSS', 'PhilHealth', 'Net Pay', 'Signature / Received By'
    ];
    const headerRow = worksheet.addRow(headers);
    headerRow.height = 22;
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
      cell.border = {
        top: { style: 'medium' }, left: { style: 'thin' },
        bottom: { style: 'medium' }, right: { style: 'thin' }
      };
    });

    // ── Data rows ──
    payrolls.forEach(p => {
      const u = userMap[p.userId];
      const department  = (u && u.department) ? u.department : '—';
      const requiredHrs = (u && u.requiredHours) ? u.requiredHours : 8;
      const hourlyRate  = p.baseRate || 0;
      const dailyRate   = hourlyRate * requiredHrs;
      const daysWorked  = daysWorkedMap[p.id] || 0;
      const grossPay    = p.grossPay   || 0;
      const netPay      = p.netPay     || grossPay;

      const row = worksheet.addRow([
        p.userName,
        department,
        dailyRate.toFixed(2),
        hourlyRate.toFixed(2),
        daysWorked,
        (p.totalHours || 0).toFixed(2),
        grossPay.toFixed(2),
        '', // SSS  — admin fills in
        '', // PhilHealth — admin fills in
        netPay.toFixed(2),
        ''  // Signature
      ]);

      row.height = 20;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: 'thin' }, left: { style: 'thin' },
          bottom: { style: 'thin' }, right: { style: 'thin' }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };  // Name left-align
      row.getCell(2).alignment = { vertical: 'middle', horizontal: 'left' };  // Area left-align
      row.getCell(11).font = { color: { argb: 'FFAAAAAA' } };                 // Signature hint
    });

    // ── Empty row + totals row ──
    worksheet.addRow([]);
    const totalRow = worksheet.addRow([
      'TOTAL',                                                                              // 1  Name
      '',                                                                                   // 2  Area (blank)
      '',                                                                                   // 3  Daily Rate (blank)
      '',                                                                                   // 4  Hourly Rate (blank)
      payrolls.reduce((s, p) => s + (daysWorkedMap[p.id] || 0), 0),                        // 5  Days Worked total
      payrolls.reduce((s, p) => s + (p.totalHours || 0), 0).toFixed(2),                    // 6  Hours Worked total
      payrolls.reduce((s, p) => s + (p.grossPay   || 0), 0).toFixed(2),                    // 7  Gross Pay total
      '',                                                                                   // 8  SSS — admin fills
      '',                                                                                   // 9  PhilHealth — admin fills
      payrolls.reduce((s, p) => s + (p.netPay || p.grossPay || 0), 0).toFixed(2),          // 10 Net Pay total
      ''                                                                                    // 11 Signature (blank)
    ]);
    totalRow.font = { bold: true };
    totalRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
    totalRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top: { style: 'medium' }, left: { style: 'thin' },
        bottom: { style: 'medium' }, right: { style: 'thin' }
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    const filename = `payroll-${period || 'custom'}-${date || moment().tz(PH_TZ).format('YYYY-MM-DD')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Export error:', err);
    // Can't redirect after headers might have started — end cleanly
    if (!res.headersSent) {
      req.flash('error', 'Failed to export to Excel.');
      res.redirect('/admin/payroll');
    } else {
      res.end();
    }
  }
};

// GET /admin/payroll/overview
exports.getPayrollOverview = async (req, res) => {
  try {
    const { userType, search } = req.query;

    let userQuery = { role: { not: 'admin' }, isActive: true };
    if (userType) userQuery.role = userType;
    if (search) {
      userQuery.OR = [
        { name:   { contains: search, mode: 'insensitive' } },
        { userId: { contains: search, mode: 'insensitive' } }
      ];
    }

    const users = await prisma.user.findMany({ where: userQuery, orderBy: { name: 'asc' } });

    // For each user, grab their latest payroll record
    const overview = await Promise.all(users.map(async (u) => {
      const latest = await prisma.payroll.findFirst({
        where: { userId: u.userId },
        orderBy: { createdAt: 'desc' }
      });
      const totalPayrolls = await prisma.payroll.count({ where: { userId: u.userId } });
      const unpaidCount   = await prisma.payroll.count({ where: { userId: u.userId, isPaid: false } });
      const totalNetPaid  = await prisma.payroll.aggregate({
        _sum: { netPay: true },
        where: { userId: u.userId, isPaid: true }
      });
      // Pending cash advances
      const pendingAdv = await prisma.cashAdvance.aggregate({
        _sum: { amount: true },
        _count: { id: true },
        where: { employeeId: u.id, status: 'pending' }
      });

      return {
        userId: u.userId,
        userName: u.name,
        role: u.role,
        department: u.department || '—',
        hourlyRate: u.hourlyRate,
        totalPayrolls,
        unpaidCount,
        totalNetPaid: totalNetPaid._sum.netPay || 0,
        pendingAdvanceAmount: pendingAdv._sum.amount || 0,
        pendingAdvanceCount: pendingAdv._count.id || 0,
        latest: latest ? { ...latest, _id: latest.id } : null
      };
    }));

    res.render('admin/payroll-overview', {
      title: 'Payroll Overview',
      overview,
      userType: userType || '',
      search: search || '',
      user: req.session.user
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/payroll');
  }
};
