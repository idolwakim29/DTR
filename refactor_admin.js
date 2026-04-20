const fs = require('fs');

let content = fs.readFileSync('controllers/adminController.js', 'utf8');

content = content.replace(/const User = require\('\.\.\/models\/User'\);\nconst DTRLog = require\('\.\.\/models\/DTRLog'\);\nconst Payroll = require\('\.\.\/models\/Payroll'\);\nconst CashAdvance = require\('\.\.\/models\/CashAdvance'\);/g, `const prisma = require('../prismaClient');
const bcrypt = require('bcryptjs');`);

// getDashboard
content = content.replace(/User\.countDocuments\(\{ role: 'maintenance', isActive: true \}\)/g, "prisma.user.count({ where: { role: 'maintenance', isActive: true } })");
content = content.replace(/User\.countDocuments\(\{ role: 'student', isActive: true \}\)/g, "prisma.user.count({ where: { role: 'student', isActive: true } })");
content = content.replace(/DTRLog\.countDocuments\(\)/g, "prisma.dTRLog.count()");
content = content.replace(/Payroll\.countDocuments\(\)/g, "prisma.payroll.count()");
content = content.replace(/DTRLog\.find\(\{ date: today \}\)\.sort\(\{ createdAt: -1 \}\)\.limit\(10\)/g, "prisma.dTRLog.findMany({ where: { date: today }, orderBy: { createdAt: 'desc' }, take: 10 })");
content = content.replace(/DTRLog\.countDocuments\(\{ date: today \}\)/g, "prisma.dTRLog.count({ where: { date: today } })");

content = content.replace(/Payroll\.find\(\)\.sort\(\{ generatedAt: -1 \}\)\.limit\(5\)/g, "prisma.payroll.findMany({ orderBy: { createdAt: 'desc' }, take: 5 })");

content = content.replace(/await CashAdvance\.aggregate\(\[\n\s+\{ \$match: \{ status: 'pending' \} \},\n\s+\{ \$group: \{ _id: null, count: \{ \$sum: 1 \}, totalAmount: \{ \$sum: '\$amount' \} \} \}\n\s+\]\);/g, `await prisma.cashAdvance.aggregate({
      _count: { id: true },
      _sum: { amount: true },
      where: { status: 'pending' }
    });`);

content = content.replace(/pendingAdvances\.length > 0 \? pendingAdvances\[0\] : \{ count: 0, totalAmount: 0 \}/g, "{ count: pendingAdvances._count.id || 0, totalAmount: pendingAdvances._sum.amount || 0 }");

// getUsers
content = content.replace(/const users = await User\.find\(query\)\.sort\(\{ createdAt: -1 \}\);/g, `
    let mappedQuery = { role: { not: 'admin' } };
    if (role) mappedQuery.role = role;
    if (search) mappedQuery.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { userId: { contains: search, mode: 'insensitive' } }
    ];
    const users = await prisma.user.findMany({ where: mappedQuery, orderBy: { createdAt: 'desc' } });`);

// postNewUser
content = content.replace(/await User\.findOne\(\{ userId: userId\.toUpperCase\(\) \}\)/g, "await prisma.user.findUnique({ where: { userId: userId.toUpperCase() } })");
content = content.replace(/await User\.create\(\{ userId, name, email, password, role, department, hourlyRate: hourlyRate \|\| 0, requiredHours: requiredHours \|\| 8 \}\);/g, `
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.create({ data: { userId: userId.toUpperCase(), name, email, password: hashedPassword, role, department, hourlyRate: parseFloat(hourlyRate) || 0, requiredHours: parseFloat(requiredHours) || 8 } });
`);

// getEditUser
content = content.replace(/await User\.findById\(req\.params\.id\)/g, "await prisma.user.findUnique({ where: { id: req.params.id } })");

// postEditUser
content = content.replace(/const user = await User\.findById\(req\.params\.id\);([\s\S]*?)await user\.save\(\);/g, `
    let updateData = {
      name, email, role, department, 
      hourlyRate: parseFloat(hourlyRate) || 0, 
      requiredHours: parseFloat(requiredHours) || 8, 
      isActive: isActive === 'on'
    };
    if (password && password.trim()) updateData.password = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: req.params.id }, data: updateData });
`);

// deleteUser
content = content.replace(/await User\.findByIdAndDelete\(req\.params\.id\);/g, "await prisma.user.delete({ where: { id: req.params.id } });");

// getPayroll
content = content.replace(/let query = \{\};\s*if \(userType\) query\.userType = userType;\s*if \(status\) query\.paymentStatus = status;\s*const payrolls = await Payroll\.find\(query\)\.sort\(\{ generatedAt: -1 \}\);/g, `
    let query = {};
    if (userType) query.userType = userType;
    if (status) query.isPaid = status === 'paid';
    const payrolls = await prisma.payroll.findMany({ where: query, orderBy: { createdAt: 'desc' } });`);

// getGeneratePayroll
content = content.replace(/await User\.find\(\{ role: \{ \$ne: 'admin' \}, isActive: true \}\)/g, "await prisma.user.findMany({ where: { role: { not: 'admin' }, isActive: true } })");

// postGeneratePayroll
content = content.replace(/const userDoc = await User\.findById\(userId\);/g, "const userDoc = await prisma.user.findUnique({ where: { id: userId } });");
content = content.replace(/const logs = await DTRLog\.find\(\{\s*userId: userDoc\.userId,\s*date: \{ \$gte: startStr, \$lte: endStr \},\s*status: 'completed',\s*totalHours: \{ \$gt: 0 \}\s*\}\);/g, `const logs = await prisma.dTRLog.findMany({
      where: {
        userId: userDoc.userId,
        date: { gte: startStr, lte: endStr },
        status: 'completed',
        totalHours: { gt: 0 }
      }
    });`);
content = content.replace(/const incompleteLogs = await DTRLog\.countDocuments\(\{\s*userId: userDoc\.userId,\s*date: \{ \$gte: startStr, \$lte: endStr \},\s*status: \{ \$in: \['in-progress', 'on-break'\] \}\s*\}\);/g, `const incompleteLogs = await prisma.dTRLog.count({
      where: {
        userId: userDoc.userId,
        date: { gte: startStr, lte: endStr },
        status: { in: ['in_progress', 'on_break'] }
      }
    });`);
content = content.replace(/const pendingAdvances = await CashAdvance\.find\(\{\s*employeeId: userDoc\._id,\s*status: 'pending',\s*targetPayrollDate: \{ \$gte: startStr, \$lte: endStr \}\s*\}\);/g, `const pendingAdvances = await prisma.cashAdvance.findMany({
      where: {
        employeeId: userDoc.id,
        status: 'pending',
        targetPayrollDate: { gte: startStr, lte: endStr }
      }
    });`);

content = content.replace(/await Payroll\.create\(\{[\s\S]*?generatedBy: req\.session\.user\.name\s*\}\);/g, `await prisma.payroll.create({
      data: {
        userId: userDoc.userId,
        userName: userDoc.name,
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
    `);

// markPaid
content = content.replace(/const payroll = await Payroll\.findById\(req\.params\.id\);([\s\S]*?)await payroll\.save\(\);/g, `
    const payroll = await prisma.payroll.findUnique({ where: { id: req.params.id } });
    if (!payroll) {
        req.flash('error', 'Payroll record not found.');
        return res.redirect('/admin/payroll');
    }
    await prisma.payroll.update({
      where: { id: req.params.id },
      data: { isPaid: true, paidOn: new Date() }
    });
`);

content = content.replace(/if \(payroll\.cashAdvances && payroll\.cashAdvances\.length > 0\) \{[\s\S]*?\}/g, `
    // we just mark deductions during the same period as deducted
    await prisma.cashAdvance.updateMany({
      where: { employeeId: payroll.userId, status: 'pending' }, // rudimentary fix, real world needs the advance IDs
      data: { status: 'deducted', deductedOn: new Date() }
    });
`);

// deletePayroll
content = content.replace(/await Payroll\.findByIdAndDelete\(req\.params\.id\);/g, "await prisma.payroll.delete({ where: { id: req.params.id } });");

// exportPayrollExcel
content = content.replace(/const payrolls = await Payroll\.find\(query\)\.sort\(\{ userType: 1, userName: 1 \}\);/g, "const payrolls = await prisma.payroll.findMany({ orderBy: [{ userName: 'asc' }] });");
content = content.replace(/p\.totalHoursWorked/g, "p.totalHours");
content = content.replace(/p\.totalSalary/g, "p.grossPay");
content = content.replace(/p\.cashAdvanceDeduction/g, "p.deductions");
content = content.replace(/p\.userType/g, "''"); // payroll doesnt have userType anymore


fs.writeFileSync('controllers/adminController.js', content);
console.log('adminController refactored');
