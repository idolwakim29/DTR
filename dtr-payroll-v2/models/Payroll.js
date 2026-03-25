const mongoose = require('mongoose');

const payrollSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  userType: {
    type: String,
    enum: ['maintenance', 'student'],
    required: true
  },
  hourlyRate: { type: Number, required: true },
  totalHoursWorked:    { type: Number, required: true },
  totalOvertimeHours:  { type: Number, default: 0 },
  totalUndertimeHours: { type: Number, default: 0 },
  totalSalary: { type: Number, required: true },
  periodType: {
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    required: true
  },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  paymentStatus: {
    type: String,
    enum: ['paid', 'unpaid'],
    default: 'unpaid'
  },
  generatedBy: { type: String },
  generatedAt: { type: Date, default: Date.now },
  paidAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Payroll', payrollSchema);
