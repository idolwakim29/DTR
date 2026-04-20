const prisma = require('../prismaClient');

exports.getList = async (req, res) => {
  try {
    const advances = await prisma.cashAdvance.findMany({
      include: { employee: true },
      orderBy: { dateRequested: 'desc' }
    });
    const users = await prisma.user.findMany({
      where: { role: { not: 'admin' }, isActive: true }
    });
    
    // Map employee safely if needed
    const mappedAdvances = advances.map(a => ({
      ...a,
      _id: a.id,
      employeeId: a.employee // mimicking mongoose populate
    }));

    res.render('admin/cash-advance', {
      title: 'Cash Advances',
      advances: mappedAdvances,
      users: users.map(u => ({ ...u, _id: u.id })),
      user: req.session.user,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
};

exports.postCreate = async (req, res) => {
  try {
    const { employeeId, amount, targetPayrollDate, notes } = req.body;
    
    if (!employeeId || amount <= 0 || !targetPayrollDate) {
      req.flash('error', 'Invalid input. Please provide valid details.');
      return res.redirect('/admin/cash-advances');
    }

    await prisma.cashAdvance.create({
      data: {
        employeeId,
        amount: parseFloat(amount),
        targetPayrollDate,
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
      data: { status: 'deducted' }
    });
    req.flash('success', 'Cash advance marked as deducted.');
    res.redirect('/admin/cash-advances');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error updating status.');
    res.redirect('/admin/cash-advances');
  }
};
