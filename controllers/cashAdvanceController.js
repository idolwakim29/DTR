const CashAdvance = require('../models/CashAdvance');
const User = require('../models/User');

exports.getList = async (req, res) => {
  try {
    const advances = await CashAdvance.find().populate('employeeId').sort({ dateRequested: -1 });
    const users = await User.find({ role: { $ne: 'admin' }, isActive: true });
    
    res.render('admin/cash-advance', {
      title: 'Cash Advances',
      advances,
      users,
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

    await CashAdvance.create({
      employeeId,
      amount,
      targetPayrollDate,
      notes,
      status: 'pending'
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
    const ca = await CashAdvance.findById(req.params.id);
    if (ca) {
      ca.status = 'deducted';
      await ca.save();
      req.flash('success', 'Cash advance marked as deducted.');
    }
    res.redirect('/admin/cash-advances');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error updating status.');
    res.redirect('/admin/cash-advances');
  }
};
