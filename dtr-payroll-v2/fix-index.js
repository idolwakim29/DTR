// Run this script once to drop the stale index
// Usage: node fix-index.js

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dtr_payroll_db';

async function fixIndex() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
  const collection = db.collection('users');

  try {
    const indexes = await collection.indexes();
    console.log('Current indexes:', indexes.map(i => i.name));

    await collection.dropIndex('idNumber_1');
    console.log('✅ Dropped stale index: idNumber_1');
  } catch (err) {
    if (err.code === 27) {
      console.log('ℹ️  Index idNumber_1 not found (already clean).');
    } else {
      console.error('Error:', err.message);
    }
  }

  await mongoose.disconnect();
  console.log('Done. Now run: npm run seed');
  process.exit(0);
}

fixIndex().catch(err => { console.error(err); process.exit(1); });