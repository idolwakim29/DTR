
const mongoose = require('mongoose');
const User = require('../models/User');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Error: ${error.message}`);
    process.exit(1);
  }
};

const ensureAdminUser = async () => {
  const adminUserId = process.env.ADMIN_USERID || 'ADMIN001';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admincjc123';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@cjc.edu.ph';
  const adminName = process.env.ADMIN_NAME || 'System Administrator';

  try {
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (!existingAdmin) {
      await User.create({
        userId: adminUserId,
        name: adminName,
        email: adminEmail,
        password: adminPassword,
        role: 'admin',
        department: 'IT',
        hourlyRate: 0
      });
      console.log(`✅ Built-in admin created: ${adminUserId} / ${adminPassword}`);
    }
  } catch (error) {
    console.error(`❌ Admin creation error: ${error.message}`);
  }
};

module.exports = connectDB;
module.exports.ensureAdminUser = ensureAdminUser;
