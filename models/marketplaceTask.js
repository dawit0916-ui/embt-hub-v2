const mongoose = require('mongoose');

const marketplaceTaskSchema = new mongoose.Schema({
  creatorUserId: { type: Number, required: true, index: true },
  videoId: { type: String, required: true },
  title: { type: String, default: null },
  thumbnailUrl: { type: String, required: true },
  watchDurationSeconds: { type: Number, required: true },
  pointCost: { type: Number, required: true }, // DASH per approved view
  allowedCountries: { type: [String], default: [] }, // empty = all countries
  status: {
    type: String,
    enum: ['active', 'paused', 'deleted'],
    default: 'active',
  },
  pauseReason: { type: String, default: null }, // e.g. 'insufficient_balance'
  viewsApproved: { type: Number, default: 0 },
  dashSpent: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('MarketplaceTask', marketplaceTaskSchema);
