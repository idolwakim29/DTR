require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const DTRLog = require('../models/DTRLog');

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
};

const seed = async () => {
  await connectDB();

  await User.deleteMany({});
  await DTRLog.deleteMany({});

  const users = [
    // Admin
    { userId: 'ADMIN001', name: 'System Administrator', email: 'admin@cjc.edu.ph', password: 'admin123', role: 'admin', department: 'IT', hourlyRate: 0 },
    // Maintenance Staff
    { userId: 'MNT001', name: 'Juan dela Cruz', email: 'juan@cjc.edu.ph', password: 'password123', role: 'maintenance', department: 'Facilities', hourlyRate: 75.00 },
    { userId: 'MNT002', name: 'Pedro Santos', email: 'pedro@cjc.edu.ph', password: 'password123', role: 'maintenance', department: 'Grounds', hourlyRate: 70.00 },
    { userId: 'MNT003', name: 'Maria Garcia', email: 'maria@cjc.edu.ph', password: 'password123', role: 'maintenance', department: 'Housekeeping', hourlyRate: 72.50 },
    // Students
    { userId: 'STD001', name: 'Ana Reyes', email: 'ana@cjc.edu.ph', password: 'password123', role: 'student', department: 'BSIT', hourlyRate: 50.00 },
    { userId: 'STD002', name: 'Carlo Mendoza', email: 'carlo@cjc.edu.ph', password: 'password123', role: 'student', department: 'BSED', hourlyRate: 50.00 },
    { userId: 'STD003', name: 'Liza Torres', email: 'liza@cjc.edu.ph', password: 'password123', role: 'student', department: 'BSA', hourlyRate: 50.00 },
  ];

  const created = await User.create(users);
  console.log(`✅ Created ${created.length} users`);

  // Seed some DTR logs
  const moment = require('moment');
  const today = moment().format('YYYY-MM-DD');
  const yesterday = moment().subtract(1, 'day').format('YYYY-MM-DD');
  const twoDaysAgo = moment().subtract(2, 'day').format('YYYY-MM-DD');

  const mnt1 = created.find(u => u.userId === 'MNT001');
  const mnt2 = created.find(u => u.userId === 'MNT002');
  const std1 = created.find(u => u.userId === 'STD001');
  const std2 = created.find(u => u.userId === 'STD002');

  const logs = [
    { user: mnt1._id, userId: 'MNT001', userName: 'Juan dela Cruz', userType: 'maintenance', date: today, timeIn: new Date(`${today}T08:00:00`), timeOut: new Date(`${today}T17:00:00`) },
    { user: mnt2._id, userId: 'MNT002', userName: 'Pedro Santos', userType: 'maintenance', date: today, timeIn: new Date(`${today}T07:30:00`) },
    { user: std1._id, userId: 'STD001', userName: 'Ana Reyes', userType: 'student', date: today, timeIn: new Date(`${today}T09:00:00`), timeOut: new Date(`${today}T12:00:00`) },
    { user: std2._id, userId: 'STD002', userName: 'Carlo Mendoza', userType: 'student', date: today, timeIn: new Date(`${today}T09:15:00`) },
    { user: mnt1._id, userId: 'MNT001', userName: 'Juan dela Cruz', userType: 'maintenance', date: yesterday, timeIn: new Date(`${yesterday}T08:00:00`), timeOut: new Date(`${yesterday}T17:00:00`) },
    { user: std1._id, userId: 'STD001', userName: 'Ana Reyes', userType: 'student', date: yesterday, timeIn: new Date(`${yesterday}T09:00:00`), timeOut: new Date(`${yesterday}T13:00:00`) },
    { user: mnt1._id, userId: 'MNT001', userName: 'Juan dela Cruz', userType: 'maintenance', date: twoDaysAgo, timeIn: new Date(`${twoDaysAgo}T08:00:00`), timeOut: new Date(`${twoDaysAgo}T17:30:00`) },
  ];

  await DTRLog.create(logs);
  console.log(`✅ Created ${logs.length} DTR logs`);
  console.log('\n--- LOGIN CREDENTIALS ---');
  console.log('Admin:       ADMIN001 / admin123');
  console.log('Maintenance: MNT001   / password123');
  console.log('Student:     STD001   / password123');
  console.log('------------------------');
  process.exit(0);
};

seed().catch(err => { console.error(err); process.exit(1); });
