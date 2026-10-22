const mongoose = require('mongoose');

const marketplaceSubmissionSchema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketplaceTask', required: true, index: true },
  viewerUserId: { type: Number, required: true, index: true },
  taskStartedAt: { type: Date, required: true }, // server-side start time
  screenshotFileId: { type: String, default: null },
  filenameTimestampMatch: { type: String, default: 'not_present' }, // informational only
  filenameAppMatch: { type: String, default: 'not_present' },
  filenameAppRaw: { type: String, default: null },
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
  rejectionReason: { type: String, default: null }, // real rejections only
  flagReason: { type: String, default: null },      // why it went to manual review
  holdsSlot: { type: Boolean, default: true },      // true while approved/pending
  reviewedBy: { type: Number, default: null },
  reviewedAt: { type: Date, default: null },
  reviewNote: { type: String, default: null },
}, { timestamps: true });

// One live (approved/pending) submission per viewer per task, enforced by the DB
marketplaceSubmissionSchema.index(
  { taskId: 1, viewerUserId: 1 },
  { unique: true, partialFilterExpression: { holdsSlot: true } }
);

module.exports = mongoose.model('MarketplaceSubmission', marketplaceSubmissionSchema);
