const mongoose = require('mongoose');

// global registry — independent of submission lifecycle, so dedup checks
// persist even if a submission is later deleted/rejected
const screenshotFingerprintSchema = new mongoose.Schema({
  sha256: { type: String, required: true, index: true },
  pHash: { type: String, required: true, index: true },
  userId: { type: Number, required: true },
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceTask', required: true },
  submittedAt: { type: Date, default: Date.now },
});
// the perceptual check sorts by newest first; without this index Mongo sorts the whole collection
screenshotFingerprintSchema.index({ submittedAt: -1 });
module.exports = mongoose.model('ScreenshotFingerprint', screenshotFingerprintSchema);
