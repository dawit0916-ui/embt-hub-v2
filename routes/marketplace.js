const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const router = express.Router();

const { User, MarketplaceTask, MarketplaceSubmission, ScreenshotFingerprint } = require('../models');
const validateInitData = require('../middleware/validateInitData');
const checkVpn = require('../middleware/checkVpn');
const fingerprintCheck = require('../middleware/fingerprintCheck');
const ocrStatsForNerds = require('../middleware/ocrStatsForNerds');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function extractVideoId(url) {
  const match = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{6,})/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------
// GET /marketplace/fetch-meta?url=...  (from earlier)
// ---------------------------------------------------------------
router.get('/fetch-meta', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  const videoId = extractVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'Could not extract a video ID from that link' });

  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const oembedRes = await fetch(oembedUrl);
    if (!oembedRes.ok) return res.json({ videoId, title: null, thumbnailUrl });
    const data = await oembedRes.json();
    res.json({ videoId, title: data.title, thumbnailUrl });
  } catch (err) {
    console.error('fetch-meta error:', err.message);
    res.json({ videoId, title: null, thumbnailUrl });
  }
});

// ---------------------------------------------------------------
// POST /marketplace/post — creator posts a new task
// ---------------------------------------------------------------
router.post('/post', validateInitData, async (req, res) => {
  try {
    const creatorUserId = Number(req.tgUser.id);
    const { videoId, title, thumbnailUrl, watchDuration, pointCost, allowedCountries } = req.body;

    if (!videoId || !thumbnailUrl || !watchDuration || !pointCost) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const task = await MarketplaceTask.create({
      creatorUserId,
      videoId,
      title: title || null,
      thumbnailUrl,
      watchDurationSeconds: Number(watchDuration),
      pointCost: Number(pointCost),
      allowedCountries: allowedCountries ? allowedCountries.split(',').filter(Boolean) : [],
      status: 'active',
    });

    res.json({ success: true, task });
  } catch (err) {
    console.error('POST /marketplace/post failed', err.message);
    res.status(500).json({ error: 'Could not post task' });
  }
});

// ---------------------------------------------------------------
// GET /marketplace/tasks — viewer feed (excludes own tasks + completed)
// ---------------------------------------------------------------
router.get('/tasks', validateInitData, async (req, res) => {
  try {
    const viewerUserId = Number(req.tgUser.id);

    const completedTaskIds = await MarketplaceSubmission.find({
      viewerUserId,
      status: { $in: ['approved', 'pending_review'] },
    }).distinct('taskId');

    const tasks = await MarketplaceTask.find({
      status: 'active',
      creatorUserId: { $ne: viewerUserId },
      _id: { $nin: completedTaskIds },
    }).sort({ createdAt: -1 }).limit(50);

    res.json({ tasks });
  } catch (err) {
    console.error('GET /marketplace/tasks failed', err.message);
    res.status(500).json({ error: 'Could not load tasks' });
  }
});

// ---------------------------------------------------------------
// GET /marketplace/my-posts — creator's own tasks
// ---------------------------------------------------------------
router.get('/my-posts', validateInitData, async (req, res) => {
  try {
    const creatorUserId = Number(req.tgUser.id);
    const tasks = await MarketplaceTask.find({
      creatorUserId,
      status: { $ne: 'deleted' },
    }).sort({ createdAt: -1 });

    res.json({ tasks });
  } catch (err) {
    console.error('GET /marketplace/my-posts failed', err.message);
    res.status(500).json({ error: 'Could not load your posts' });
  }
});

// ---------------------------------------------------------------
// DELETE /marketplace/task/:id
// ---------------------------------------------------------------
router.delete('/task/:id', validateInitData, async (req, res) => {
  try {
    const creatorUserId = Number(req.tgUser.id);
    const task = await MarketplaceTask.findOne({ _id: req.params.id, creatorUserId });

    if (!task) return res.status(404).json({ error: 'Task not found' });

    task.status = 'deleted';
    await task.save();

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /marketplace/task failed', err.message);
    res.status(500).json({ error: 'Could not delete task' });
  }
});

// ---------------------------------------------------------------
// POST /marketplace/submit — the full validation + payout pipeline
// ---------------------------------------------------------------
router.post(
  '/submit',
  validateInitData,
  upload.single('screenshot'),
  checkVpn,
  fingerprintCheck,
  ocrStatsForNerds,
  async (req, res) => {
    try {
      const viewerUserId = Number(req.tgUser.id);
      const { taskId, taskStartedAt } = req.body;

      const task = await MarketplaceTask.findById(taskId);
      if (!task || task.status !== 'active') {
        return res.status(404).json({ error: 'Task not found or no longer active' });
      }

      // --- 1. fingerprint check ---
      if (req.fingerprintCheck.isDuplicate) {
        await MarketplaceSubmission.create({
          taskId, viewerUserId, taskStartedAt,
          screenshotUrl: null, // not stored on reject to save space — adjust if you want to keep evidence
          sha256: req.fingerprintCheck.sha256,
          pHash: req.fingerprintCheck.pHash,
          country: req.vpnCheck.country,
          fraudScore: req.vpnCheck.fraudScore,
          status: 'rejected',
          rejectionReason: `duplicate_screenshot_${req.fingerprintCheck.matchType}`,
        });
        return res.status(403).json({ error: 'This screenshot has already been used for a submission.' });
      }

      // --- 2. country check (per-task allowedCountries) ---
      if (task.allowedCountries.length > 0 && !task.allowedCountries.includes(req.vpnCheck.country)) {
        return res.status(403).json({ error: 'This task is not available in your region.' });
      }

      // --- 3. VPN/fraud action ---
      if (req.vpnCheck.action === 'block') {
        await MarketplaceSubmission.create({
          taskId, viewerUserId, taskStartedAt,
          screenshotUrl: null,
          sha256: req.fingerprintCheck.sha256,
          pHash: req.fingerprintCheck.pHash,
          country: req.vpnCheck.country,
          fraudScore: req.vpnCheck.fraudScore,
          status: 'rejected',
          rejectionReason: 'vpn_fraud_score_block',
        });
        return res.status(403).json({ error: 'Submission blocked due to network security flag.' });
      }

      // --- 4. OCR check: video ID + elapsed time ---
      const ocrOk =
        req.ocrResult.videoId === task.videoId &&
        req.ocrResult.elapsedSeconds !== null &&
        req.ocrResult.elapsedSeconds >= task.watchDurationSeconds;

      // --- 5. timestamp sanity check ---
      const startedAt = new Date(taskStartedAt);
      const minValidTime = new Date(startedAt.getTime() + task.watchDurationSeconds * 1000);
      const now = new Date();
      const timestampOk = now >= minValidTime;

      const needsReview = req.vpnCheck.action === 'review' || !ocrOk || !timestampOk || req.ocrResult.error;

      const submissionStatus = needsReview ? 'pending_review' : 'approved';

      const submission = await MarketplaceSubmission.create({
        taskId, viewerUserId, taskStartedAt,
        screenshotUrl: `/uploads/proofs/${Date.now()}_${viewerUserId}.jpg`, // wire to your actual storage (S3/GridFS/etc)
        sha256: req.fingerprintCheck.sha256,
        pHash: req.fingerprintCheck.pHash,
        ocrVideoId: req.ocrResult.videoId,
        ocrElapsedSeconds: req.ocrResult.elapsedSeconds,
        country: req.vpnCheck.country,
        fraudScore: req.vpnCheck.fraudScore,
        status: submissionStatus,
      });

      // register the fingerprint globally regardless of outcome, so future
      // dupes are caught even if this one was only pending/rejected
      await ScreenshotFingerprint.create({
        sha256: req.fingerprintCheck.sha256,
        pHash: req.fingerprintCheck.pHash,
        userId: viewerUserId,
        taskId,
      });

      if (submissionStatus === 'pending_review') {
        return res.json({ success: true, status: 'pending_review', submission });
      }

      // --- 6. approved: atomic DASH transaction ---
      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const creator = await User.findOne({ user_id: task.creatorUserId }).session(session);

        if (!creator || creator.balance < task.pointCost) {
          // pause the task instead of letting it fail silently
          await MarketplaceTask.updateOne(
            { _id: task._id },
            { status: 'paused', pauseReason: 'insufficient_balance' },
            { session }
          );
          await MarketplaceSubmission.updateOne(
            { _id: submission._id },
            { status: 'pending_review', rejectionReason: 'creator_insufficient_balance' },
            { session }
          );
          await session.commitTransaction();
          return res.json({ success: true, status: 'pending_review', reason: 'creator_balance_insufficient' });
        }

        await User.updateOne(
          { user_id: task.creatorUserId },
          { $inc: { balance: -task.pointCost } },
          { session }
        );
        await User.updateOne(
          { user_id: viewerUserId },
          { $inc: { balance: task.pointCost } },
          { session }
        );
        await MarketplaceTask.updateOne(
          { _id: task._id },
          { $inc: { viewsApproved: 1, dashSpent: task.pointCost } },
          { session }
        );

        await session.commitTransaction();
        res.json({ success: true, status: 'approved' });
      } catch (txErr) {
        await session.abortTransaction();
        throw txErr;
      } finally {
        session.endSession();
      }
    } catch (err) {
      console.error('POST /marketplace/submit failed', err.message);
      res.status(500).json({ error: 'Submission failed — try again' });
    }
  }
);

module.exports = router;
