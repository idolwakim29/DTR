exports.isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Please login to continue.');
  res.redirect('/login');
};

exports.isAdmin = (req, res, next) => {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  res.status(403).render('error', { message: 'Access Denied. Admin only.', user: req.session.user });
};

exports.isStaff = (req, res, next) => {
  if (req.session && req.session.user && req.session.user.role !== 'admin') return next();
  res.redirect('/admin/dashboard');
};
