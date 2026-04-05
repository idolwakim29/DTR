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
    { userId: 'ADMIN001', name: 'System Administrator', email: 'admin@cjc.edu.ph', password: 'admincjc123', role: 'admin', department: 'IT', hourlyRate: 0 }
  ];

  const created = await User.create(users);
  console.log(`✅ Created ${created.length} admin user`);
  console.log('\n--- LOGIN CREDENTIALS ---');
  console.log('Admin: ADMIN001 / admincjc123');
  console.log('------------------------');
  process.exit(0);
};

seed().catch(err => { console.error(err); process.exit(1); });
