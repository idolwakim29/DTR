require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const morgan = require('morgan');
const path = require('path');
const prisma = require('./prismaClient');
const bcrypt = require('bcryptjs');
const routes = require('./routes/index');

const app = express();
app.set('trust proxy', 1);

// Initialize Admin User in Supabase
async function ensureAdminUser() {
  try {
    const adminUserId = process.env.ADMIN_USERID || 'ADMIN001';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admincjc123';
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@cjc.edu.ph';
    const adminName = process.env.ADMIN_NAME || 'System Administrator';

    const existingAdmin = await prisma.user.findFirst({
      where: { role: 'admin' }
    });

    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      await prisma.user.create({
        data: {
          userId: adminUserId,
          name: adminName,
          email: adminEmail,
          password: hashedPassword,
          role: 'admin',
          department: 'IT',
          hourlyRate: 0
        }
      });
      console.log(`✅ Built-in admin created: ${adminUserId} / ${adminPassword}`);
    }
  } catch (error) {
    console.error(`❌ Admin creation error:`, error);
  }
}

// Connect and ensure built-in admin exists
ensureAdminUser();

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

// ✅ PostgreSQL Session Store (Fixes Vercel Crash)
const dbPool = new Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(session({
  store: new pgSession({
    pool: dbPool,
    tableName: 'session'
  }),
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
  res.locals.error = req.flash('error');
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