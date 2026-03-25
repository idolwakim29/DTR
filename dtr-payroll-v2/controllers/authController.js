const User = require('../models/User');

// GET /login
exports.getLogin = (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin/dashboard' : '/dtr/me');
  }
  res.render('auth/login', { title: 'Login', error: req.flash('error') });
};

// POST /login
exports.postLogin = async (req, res) => {
  const { userId, password } = req.body;
  try {
    const user = await User.findOne({ userId: userId.toUpperCase(), isActive: true });
    if (!user) {
      req.flash('error', 'Invalid User ID or password.');
      return res.redirect('/login');
    }
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      req.flash('error', 'Invalid User ID or password.');
      return res.redirect('/login');
    }
    req.session.user = {
      _id: user._id,
      userId: user.userId,
      name: user.name,
      role: user.role
    };
    if (user.role === 'admin') return res.redirect('/admin/dashboard');
    return res.redirect('/dtr/me');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Server error. Please try again.');
    res.redirect('/login');
  }
};

// GET /logout
exports.logout = (req, res) => {
  req.session.destroy();
  res.redirect('/login');
};
