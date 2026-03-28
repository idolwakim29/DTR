const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  timeIn:  { type: Date, default: null },
  timeOut: { type: Date, default: null },
  hours:   { type: Number, default: 0 }
}, { _id: false });

const dtrLogSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userId:   { type: String, required: true },
  userName: { type: String, required: true },
  userType: { type: String, enum: ['maintenance', 'student'], required: true },
  date:     { type: String, required: true },

  // First session (AM)
  timeIn:  { type: Date, default: null },
  timeOut: { type: Date, default: null },

  // Lunch-break re-entry / additional sessions
  sessions: { type: [sessionSchema], default: [] },

  // true while user is currently clocked in (any session)
  isActive: { type: Boolean, default: false },

  totalHours:     { type: Number, default: 0 },
  requiredHours:  { type: Number, default: 8 },
  overtimeHours:  { type: Number, default: 0 },
  undertimeHours: { type: Number, default: 0 },

  status: {
    type: String,
    enum: ['in-progress', 'on-break', 'completed'],
    default: 'in-progress'
  },
  notes: { type: String }
}, { timestamps: true });

// Helper function to exclude lunch time (12 PM - 1 PM)
const excludeLunchTime = (timeIn, timeOut) => {
  const LUNCH_START = 12; // 12 PM
  const LUNCH_END = 13;   // 1 PM
  
  if (!timeIn || !timeOut) return 0;
  
  let start = new Date(timeIn);
  let end = new Date(timeOut);
  
  const startHour = start.getHours() + start.getMinutes() / 60;
  const endHour = end.getHours() + end.getMinutes() / 60;
  
  // If entire period is before or after lunch, no exclusion
  if (endHour <= LUNCH_START || startHour >= LUNCH_END) {
    return (end - start) / (1000 * 60 * 60);
  }
  
  // If entire period covers lunch, return 0
  if (startHour <= LUNCH_START && endHour >= LUNCH_END) {
    return (end - start) / (1000 * 60 * 60) - 1;
  }
  
  // If lunch period is partially within work time
  if (startHour < LUNCH_START && endHour > LUNCH_START) {
    // Started before lunch, ends during or after lunch
    const lunchOverlap = Math.min(endHour, LUNCH_END) - LUNCH_START;
    return (end - start) / (1000 * 60 * 60) - lunchOverlap;
  }
  
  if (startHour < LUNCH_END && endHour > LUNCH_END) {
    // Started during lunch, ends after lunch
    const lunchOverlap = LUNCH_END - Math.max(startHour, LUNCH_START);
    return (end - start) / (1000 * 60 * 60) - lunchOverlap;
  }
  
  // Default
  return (end - start) / (1000 * 60 * 60);
};

// Recalculate totals helper (call before save)
dtrLogSchema.methods.recalculate = function () {
  let total = 0;

  if (this.timeIn && this.timeOut) {
    total += excludeLunchTime(this.timeIn, this.timeOut);
  }

  (this.sessions || []).forEach(s => {
    if (s.timeIn && s.timeOut) {
      const h = excludeLunchTime(s.timeIn, s.timeOut);
      s.hours = Math.round(h * 100) / 100;
      total += h;
    }
  });

  this.totalHours = Math.round(total * 100) / 100;

  const req = this.requiredHours || 8;
  if (this.totalHours >= req) {
    this.overtimeHours  = Math.round((this.totalHours - req) * 100) / 100;
    this.undertimeHours = 0;
  } else {
    this.overtimeHours  = 0;
    this.undertimeHours = Math.round((req - this.totalHours) * 100) / 100;
  }
};

dtrLogSchema.pre('save', function (next) {
  this.recalculate();
  next();
});

module.exports = mongoose.model('DTRLog', dtrLogSchema);
