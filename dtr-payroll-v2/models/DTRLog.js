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

// Recalculate totals helper (call before save)
dtrLogSchema.methods.recalculate = function () {
  let total = 0;

  if (this.timeIn && this.timeOut) {
    total += (this.timeOut - this.timeIn) / (1000 * 60 * 60);
  }

  (this.sessions || []).forEach(s => {
    if (s.timeIn && s.timeOut) {
      const h = (s.timeOut - s.timeIn) / (1000 * 60 * 60);
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
