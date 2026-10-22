const mongoose = require('mongoose');

const marketplaceStartSchema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceTask', required: true },
  viewerUserId: { type: Number, required: true },
  startedAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 14 }, // auto-delete after 14 days
});
marketplaceStartSchema.index({ taskId: 1, viewerUserId: 1 }, { unique: true });

module.exports = mongoose.model('MarketplaceStart', marketplaceStartSchema);
