const mongoose = require('mongoose');


const PendingReactionSchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  messageId: { type: String, required: true },
  emoji: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Set TTL index separately (auto-delete after 48 hours)
PendingReactionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 172800 });

// Prevent duplicates
PendingReactionSchema.index({ userId: 1, messageId: 1 }, { unique: true });

const PendingReaction = mongoose.model('PendingReaction', PendingReactionSchema);

module.exports = PendingReaction;
