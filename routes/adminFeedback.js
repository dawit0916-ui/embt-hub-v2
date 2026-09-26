const express = require('express');
const router = express.Router();
const { Feedback } = require('../models');
const validateAdmin = require('../middleware/validateAdmin');
const logAdminAction = require('../utils/logAdminAction');

// GET /api/admin/feedback?status=new&type=bug&page=1
router.get('/', validateAdmin, async (req, res) => {
  try {
    const { status, type, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;

    const feedback = await Feedback.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Feedback.countDocuments(filter);

    res.json({ success: true, feedback, total, page: Number(page) });
  } catch (err) {
    console.error('Admin feedback list error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PATCH /api/admin/feedback/:id  { status: 'reviewed' | 'resolved' }
router.patch('/:id', validateAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['new', 'reviewed', 'resolved'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const updated = await Feedback.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, error: 'Not found' });

    logAdminAction(req.tgUser?.id, `Marked feedback ${req.params.id} as ${status}`);
    res.json({ success: true, feedback: updated });
  } catch (err) {
    console.error('Admin feedback update error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// DELETE /api/admin/feedback/:id
router.delete('/:id', validateAdmin, async (req, res) => {
  try {
    const deleted = await Feedback.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Not found' });

    logAdminAction(req.tgUser?.id, `Deleted feedback ${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Admin feedback delete error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
