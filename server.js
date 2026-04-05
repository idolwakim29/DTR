require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
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
    process.exit(1);
  });

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
// ✅ Use morgan only in development — Vercel logs are cleaner without it
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Sessions — now stored in MongoDB (survives Vercel cold starts)
app.use(session({
  secret: process.env.SESSION_SECRET || 'cjc_secret',
  resave: false,
  saveUninitialized: false,
  // ✅ CRITICAL: Without MongoStore, sessions reset on every Vercel redeploy
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    ttl: 8 * 60 * 60,        // 8 hours (matches cookie)
    autoRemove: 'native'      // auto-clean expired sessions
  }),
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    // ✅ Required for Vercel HTTPS
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
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

// ✅ CRITICAL for Vercel: export app in addition to listening
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 CJC DTR System running at http://localhost:${PORT}`);
  console.log(`📌 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// ✅ This line makes Vercel treat server.js as a serverless function
module.exports = app;