const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  user_id: { type: Number, required: true },
  username: String,
  type: { type: String, enum: ['bug', 'suggestion', 'complaint', 'other'], default: 'other' },
  message: { type: String, required: true },
  status: { type: String, enum: ['new', 'reviewed', 'resolved'], default: 'new' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Feedback', feedbackSchema);
