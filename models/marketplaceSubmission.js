const mongoose = require('mongoose');

const marketplaceSubmissionSchema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceTask', required: true, index: true },
  viewerUserId: { type: Number, required: true, index: true },
  taskStartedAt: { type: Date, required: true }, // when viewer tapped "Start earning"
  screenshotFileId: { type: String, default: null },
  sha256: { type: String, required: true, index: true },
  pHash: { type: String, required: true, index: true },
  ocrVideoId: { type: String, default: null },
  ocrElapsedSeconds: { type: Number, default: null },
  country: { type: String, default: null },
  fraudScore: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['approved', 'pending_review', 'rejected'],
    default: 'pending_review',
  },
  rejectionReason: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('MarketplaceSubmission', marketplaceSubmissionSchema);
