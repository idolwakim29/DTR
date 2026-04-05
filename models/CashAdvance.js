const mongoose = require('mongoose');

const cashAdvanceSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  dateRequested: {
    type: Date,
    default: Date.now
  },
  targetPayrollDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'deducted'],
    default: 'pending'
  },
  notes: {
    type: String
  }
}, { timestamps: true });

module.exports = mongoose.model('CashAdvance', cashAdvanceSchema);
