require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const morgan = require('morgan');
const path = require('path');

const connectDB = require('./config/database');
const routes = require('./routes/index');

const app = express();

// Connect to MongoDB and ensure a built-in admin exists
connectDB()
  .then(() => connectDB.ensureAdminUser && connectDB.ensureAdminUser())
  .catch(error => {
    console.error('❌ Could not initialize database:', error.message);
    // ✅ Don't exit on Vercel — just log the error
    // process.exit(1);
  });

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Sessions — NO MongoStore for now (removed to fix crash)

app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET || 'cjc_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
  maxAge: 8 * 60 * 60 * 1000,
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true,
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
}
}));

// Flash messages
app.use(flash());

// Global flash to locals
app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error   = req.flash('error');
  next();
});

// Routes
app.use('/', routes);

// 404
app.use((req, res) => {
  res.status(404).render('error', { 
    message: 'Page not found.', 
    user: req.session.user || null 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 CJC DTR System running at http://localhost:${PORT}`);
  console.log(`📌 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;