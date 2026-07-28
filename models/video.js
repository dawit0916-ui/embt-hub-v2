const express = require('express');
const router = express.Router();
const axios = require('axios');

const validateInitData = require('../middleware/validateInitData');
const bot = require('../bot/bot');
const { UserPurchase, CourseLesson } = require('../models');

// =====================================================
// SECURE VIDEO STREAMING ROUTE
// =====================================================

router.get('/api/stream-video', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { courseId, lessonId } = req.query;

        if (!courseId || !lessonId) {
            return res.status(400).json({ error: 'courseId and lessonId required' });
        }

        const purchase = await UserPurchase.findOne({ userId, productId: courseId, status: 'active' });
        if (!purchase) {
            return res.status(403).json({ error: 'You do not have access to this course' });
        }

        const lesson = await CourseLesson.findById(lessonId);
        if (!lesson || lesson.courseId.toString() !== courseId) {
            return res.status(404).json({ error: 'Lesson not found' });
        }

        if (!lesson.telegram_file_id) {
            return res.status(404).json({ error: 'Video not available' });
        }

        let filePath;
        try {
            const fileInfo = await bot.telegram.getFile(lesson.telegram_file_id);
            filePath = fileInfo.file_path;
        } catch (err) {
            console.error('[Telegram getFile Error]:', err);
            return res.status(500).json({ error: 'Unable to retrieve video' });
        }

        const telegramDownloadUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;

        const range = req.headers.range;

        const axiosConfig = {
            responseType: 'stream',
            timeout: 30000,
            maxRedirects: 5
        };
        if (range) {
            axiosConfig.headers = { Range: range };
        }

        try {
            const response = await axios.get(telegramDownloadUrl, axiosConfig);

            const contentLength = response.headers['content-length'];
            const contentRange = response.headers['content-range'];

            res.status(range ? 206 : 200);
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            if (contentLength) res.setHeader('Content-Length', contentLength);
            if (contentRange) res.setHeader('Content-Range', contentRange);

            response.data.pipe(res);

            response.data.on('error', (err) => {
                console.error('[Stream Error]:', err.message);
                if (!res.headersSent) res.status(500).json({ error: 'Stream interrupted' });
                else res.end();
            });

            // Stop pulling from Telegram if the client disconnects (tab closed, video.src reset, etc.)
            req.on('close', () => {
                if (response.data && typeof response.data.destroy === 'function') {
                    response.data.destroy();
                }
            });

        } catch (err) {
            console.error('[Stream Download Error]:', err.message);
            if (!res.headersSent) return res.status(500).json({ error: 'Failed to stream video' });
        }

    } catch (err) {
        console.error('[Video Stream Route Error]:', err);
        if (!res.headersSent) return res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
