// routes/banners.js
const express = require('express');
const router = express.Router();
const { BannerSlide } = require('../models');
const validateAdmin = require('../middleware/validateAdmin');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const bot = require('../bot/bot'); // your existing Telegraf instance
const { STORAGE_CHANNEL_ID } = require('../config/constants');

// Public: get active slides for the home screen
router.get('/api/banners', async (req, res) => {
  try {
    const slides = await BannerSlide.find({ isActive: true }).sort({ order: 1 });
    res.json({ success: true, slides });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: full CRUD
router.get('/api/admin/banners', validateAdmin, async (req, res) => {
  const slides = await BannerSlide.find().sort({ order: 1 });
  res.json({ success: true, slides });
});

router.post('/api/admin/banners', validateAdmin, async (req, res) => {
  const slide = await BannerSlide.create(req.body);
  res.json({ success: true, slide });
});

router.put('/api/admin/banners/:id', validateAdmin, async (req, res) => {
  const slide = await BannerSlide.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json({ success: true, slide });
});

router.delete('/api/admin/banners/:id', validateAdmin, async (req, res) => {
  await BannerSlide.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});
router.post('/api/admin/banners/upload', validateAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });

    const sent = await bot.telegram.sendPhoto(STORAGE_CHANNEL_ID, {
      source: req.file.buffer
    });

    // Telegram returns multiple sizes; take the largest
    const fileId = sent.photo[sent.photo.length - 1].file_id;

    res.json({ success: true, fileId });
  } catch (err) {
    console.error('Banner upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
router.get('/api/image/:fileId', async (req, res) => {
  try {
    const link = await bot.telegram.getFileLink(req.params.fileId);
    const response = await fetch(link.href);
    res.set('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400'); // cache 1 day, avoids re-hitting Telegram every load
    response.body.pipe(res);
  } catch (err) {
    res.status(404).json({ success: false, error: 'Image not found' });
  }
});

router.post('/api/banners/:id/click', async (req, res) => {
  try {
    await BannerSlide.findByIdAndUpdate(req.params.id, { $inc: { clickCount: 1 } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
