const prisma = require('../prismaClient');

exports.getList = async (req, res) => {
  try {
    const { search } = req.query;
    let advanceWhere = {};

    if (search) {
      // Search by employee name or userId — we need to find matching user IDs first
      const matchingUsers = await prisma.user.findMany({
        where: {
          AND: [
            { role: { not: 'admin' } },
            { OR: [
              { name:   { contains: search, mode: 'insensitive' } },
              { userId: { contains: search, mode: 'insensitive' } }
            ]}
          ]
        },
        select: { id: true }
      });
      const ids = matchingUsers.map(u => u.id);
      advanceWhere.employeeId = { in: ids };
    }

    const advances = await prisma.cashAdvance.findMany({
      where: advanceWhere,
      include: { employee: true },
      orderBy: { dateRequested: 'desc' }
    });
    const users = await prisma.user.findMany({
      where: { role: { not: 'admin' }, isActive: true }
    });

    const mappedAdvances = advances.map(a => ({
      ...a,
      _id: a.id,
      employeeId: a.employee
    }));

    res.render('admin/cash-advance', {
      title: 'Cash Advances',
      advances: mappedAdvances,
      users: users.map(u => ({ ...u, _id: u.id })),
      user: req.session.user,
      search: search || ''
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
};

exports.postCreate = async (req, res) => {
  try {
    const { employeeId, amount, targetPayrollDate, notes } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!employeeId || isNaN(parsedAmount) || parsedAmount <= 0 || !targetPayrollDate) {
      req.flash('error', 'Invalid input. Please provide a valid employee, amount, and target date.');
      return res.redirect('/admin/cash-advances');
    }

    // Normalize date to YYYY-MM-DD so string comparisons in payroll generation work correctly
    const normalizedDate = new Date(targetPayrollDate).toISOString().slice(0, 10);

    await prisma.cashAdvance.create({
      data: {
        employeeId,
        amount: parsedAmount,
        targetPayrollDate: normalizedDate,
        notes,
        status: 'pending'
      }
    });

    req.flash('success', 'Cash advance recorded successfully.');
    res.redirect('/admin/cash-advances');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error recording cash advance.');
    res.redirect('/admin/cash-advances');
  }
};

exports.postMarkDeducted = async (req, res) => {
  try {
    await prisma.cashAdvance.update({
      where: { id: req.params.id },
      data: { status: 'deducted', deductedOn: new Date() }
    });
    req.flash('success', 'Cash advance marked as deducted.');
    res.redirect('/admin/cash-advances');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error updating status.');
    res.redirect('/admin/cash-advances');
  }
};

exports.postDelete = async (req, res) => {
  try {
    await prisma.cashAdvance.delete({ where: { id: req.params.id } });
    req.flash('success', 'Cash advance record deleted.');
    res.redirect('/admin/cash-advances');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error deleting cash advance.');
    res.redirect('/admin/cash-advances');
  }
};

