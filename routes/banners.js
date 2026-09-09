// routes/banners.js
const express = require('express');
const router = express.Router();
const { BannerSlide } = require('../models');
const validateAdmin = require('../middleware/validateAdmin');
const multer = require('multer');
const axios = require('axios');
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

    const fileId = sent.photo[sent.photo.length - 1].file_id;
    const imageUrl = `${req.protocol}://${req.get('host')}/api/image/${fileId}`;

    res.json({ success: true, fileId, imageUrl });
  } catch (err) {
    console.error('Banner upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
router.get('/api/image/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;

        let filePath;
        try {
            const fileInfo = await bot.telegram.getFile(fileId);
            filePath = fileInfo.file_path;
        } catch (err) {
            console.error('[Telegram getFile Error]:', err);
            return res.status(404).json({ success: false, error: 'Image not found' });
        }

        const telegramDownloadUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;

        try {
            const response = await axios.get(telegramDownloadUrl, {
                responseType: 'stream',
                timeout: 15000,
                maxRedirects: 5
            });

            res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');

            response.data.pipe(res);

            response.data.on('error', (err) => {
                console.error('[Image Stream Error]:', err.message);
                if (!res.headersSent) res.status(500).json({ success: false, error: 'Stream interrupted' });
                else res.end();
            });
            req.on('close', () => {
                if (response.data && typeof response.data.destroy === 'function') {
                    response.data.destroy();
                }
            });
        } catch (err) {
            console.error('[Image Download Error]:', err.message);
            if (!res.headersSent) return res.status(500).json({ success: false, error: 'Failed to load image' });
        }
    } catch (err) {
        console.error('[Image Route Error]:', err);
        if (!res.headersSent) return res.status(500).json({ success: false, error: 'Server error' });
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

router.post('/api/admin/banners/:id/reset-clicks', validateAdmin, async (req, res) => {
  try {
    const slide = await BannerSlide.findByIdAndUpdate(
      req.params.id,
      { clickCount: 0, resetClicksAt: new Date() },
      { new: true }
    );
    if (!slide) return res.status(404).json({ success: false, error: 'Slide not found' });
    res.json({ success: true, slide });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
