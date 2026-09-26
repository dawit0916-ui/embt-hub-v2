const express = require('express');
const router = express.Router();
const { Feedback } = require('../models');
const validateInitData = require('../middleware/validateInitData');

router.post('/', validateInitData, async (req, res) => {
  try {
    const { type, message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Message required' });
    }

    const userId = Number(req.tgUser.id);
    await Feedback.create({
      user_id: userId,
      username: req.tgUser.username || null,
      type,
      message: message.trim()
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Feedback submit error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
