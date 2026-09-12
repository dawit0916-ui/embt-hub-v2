const express = require('express');
const router = express.Router();
const validateAdmin = require('../middleware/validateAdmin');
const { MarketplaceSubmission, MarketplaceTask } = require('../models');
const { getStorageFileUrl } = require('../utils/telegramStorage');
const { approveSubmission } = require('./marketplace'); // export this from marketplace.js

// GET /admin/marketplace/pending — review queue
router.get('/pending', validateAdmin, async (req, res) => {
  try {
    const submissions = await MarketplaceSubmission.find({ status: 'pending_review' })
      .sort({ createdAt: 1 })
      .populate('taskId')
      .limit(100);

    // resolve a viewable URL for each screenshot on the fly
    const withUrls = await Promise.all(
      submissions.map(async (s) => ({
        ...s.toObject(),
        screenshotViewUrl: s.screenshotFileId ? await getStorageFileUrl(s.screenshotFileId) : null,
      }))
    );

    res.json({ submissions: withUrls });
  } catch (err) {
    console.error('GET /admin/marketplace/pending failed', err.message);
    res.status(500).json({ error: 'Could not load review queue' });
  }
});

// POST /admin/marketplace/:id/approve
router.post('/:id/approve', validateAdmin, async (req, res) => {
  try {
    const submission = await MarketplaceSubmission.findById(req.params.id);
    if (!submission || submission.status !== 'pending_review') {
      return res.status(404).json({ error: 'Submission not found or already resolved' });
    }
    const task = await MarketplaceTask.findById(submission.taskId);
    const result = await approveSubmission(submission, task);
    res.json({ success: true, result });
  } catch (err) {
    console.error('POST /admin/marketplace/:id/approve failed', err.message);
    res.status(500).json({ error: 'Approval failed' });
  }
});

// POST /admin/marketplace/:id/reject
router.post('/:id/reject', validateAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const submission = await MarketplaceSubmission.findById(req.params.id);
    if (!submission || submission.status !== 'pending_review') {
      return res.status(404).json({ error: 'Submission not found or already resolved' });
    }
    submission.status = 'rejected';
    submission.rejectionReason = reason || 'manual_admin_reject';
    await submission.save();
    res.json({ success: true });
  } catch (err) {
    console.error('POST /admin/marketplace/:id/reject failed', err.message);
    res.status(500).json({ error: 'Rejection failed' });
  }
});

module.exports = router;
