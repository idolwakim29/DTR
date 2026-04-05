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
    if (user.role !== 'admin') {
      req.flash('error', 'This login is for administrators only.');
      return res.redirect('/login');
    }

    // ✅ Set session
    req.session.user = {
      _id: user._id,
      userId: user.userId,
      name: user.name,
      role: user.role
    };

    // ✅ CRITICAL FIX: Save session before redirecting on Vercel
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        req.flash('error', 'Session error. Please try again.');
        return res.redirect('/login');
      }
      const redirectTo = user.role === 'admin' ? '/admin/dashboard' : '/dtr/me';
      return res.redirect(redirectTo);
    });

  } catch (err) {
    console.error(err);
    req.flash('error', 'Server error. Please try again.');
    res.redirect('/login');
  }
};

// GET /logout
exports.logout = (req, res) => {
  // ✅ Fix logout — properly destroy session
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.redirect('/login');
  });
};