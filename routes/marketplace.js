const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const router = express.Router();

const { User, MarketplaceTask, MarketplaceSubmission, MarketplaceStart, ScreenshotFingerprint } = require('../models');
const validateInitData = require('../middleware/validateInitData');
const checkVpn = require('../middleware/checkVpn');
const fingerprintCheck = require('../middleware/fingerprintCheck');
const ocrStatsForNerds = require('../middleware/ocrStatsForNerds');
const { uploadScreenshotToStorage } = require('../utils/telegramStorage');
const { parseScreenshotFilename } = require('../utils/filenameCheck');
const { approveSubmission } = require('../utils/marketplaceApproval');
const { MARKETPLACE_MIN_COST, MARKETPLACE_MAX_COST } = require('../config/constants');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// ---------------- helpers ----------------
function extractVideoId(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function cleanTitle(t) {
  if (typeof t !== 'string') return null;
  const s = t.replace(/[\u0000-\u001F\u007F<>]/g, '').trim().slice(0, 120);
  return s || null;
}

function parseCountries(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  return [...new Set(list.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))].slice(0, 50);
}

async function getYoutubeMeta(videoId) {
  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const r = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!r.ok) return { videoId, title: null, thumbnailUrl };
    const d = await r.json();
    return { videoId, title: cleanTitle(d.title), thumbnailUrl };
  } catch (err) {
    console.error('getYoutubeMeta error:', err.message);
    return { videoId, title: null, thumbnailUrl };
  }
}

// simple per-user limiter: 5 submits / minute
const submitHits = new Map();
function submitRateLimit(req, res, next) {
  const uid = Number(req.tgUser.id);
  const now = Date.now();
  const hits = (submitHits.get(uid) || []).filter((t) => now - t < 60000);
  if (hits.length >= 5) return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
  hits.push(now);
  submitHits.set(uid, hits);
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of submitHits) if (!v.some((t) => now - t < 60000)) submitHits.delete(k);
}, 5 * 60 * 1000).unref();

function uploadScreenshot(req, res, next) {
  upload.single('screenshot')(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large — max 8MB.' : 'Upload failed.',
      });
    }
    next();
  });
}

// ---------------- meta preview ----------------
router.get('/fetch-meta', validateInitData, async (req, res) => {
  const videoId = extractVideoId(req.query.url);
  if (!videoId) return res.status(400).json({ error: 'Could not extract a video ID from that link' });
  res.json(await getYoutubeMeta(videoId));
});

// ---------------- creator: post ----------------
router.post('/post', validateInitData, async (req, res) => {
  try {
    const creatorUserId = Number(req.tgUser.id);
    const { videoId, watchDuration, pointCost, allowedCountries } = req.body;

    if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ''))) {
      return res.status(400).json({ error: 'Invalid video' });
    }
    const duration = Math.floor(Number(watchDuration));
    if (!Number.isFinite(duration) || duration < 60 || duration > 3600) {
      return res.status(400).json({ error: 'Invalid watch duration' });
    }
    const cost = Math.round(Number(pointCost) * 100) / 100;
    if (!Number.isFinite(cost) || cost < MARKETPLACE_MIN_COST || cost > MARKETPLACE_MAX_COST) {
      return res.status(400).json({ error: `Cost must be between ${MARKETPLACE_MIN_COST} and ${MARKETPLACE_MAX_COST} DASH` });
    }

    const creator = await User.findOne({ user_id: creatorUserId }).select('balance').lean();
    if (!creator || creator.balance < cost) {
      return res.status(400).json({ error: 'Not enough DASH balance to post this task' });
    }

    // title + thumbnail are built server-side, never trusted from the client
    const meta = await getYoutubeMeta(videoId);

    const task = await MarketplaceTask.create({
      creatorUserId,
      videoId,
      title: meta.title,
      thumbnailUrl: meta.thumbnailUrl,
      watchDurationSeconds: duration,
      pointCost: cost,
      allowedCountries: parseCountries(allowedCountries),
      status: 'active',
    });

    res.json({ success: true, task });
  } catch (err) {
    console.error('POST /marketplace/post failed', err.message);
    res.status(500).json({ error: 'Could not post task' });
  }
});

// ---------------- viewer: feed ----------------
router.get('/tasks', validateInitData, async (req, res) => {
  try {
    const viewerUserId = Number(req.tgUser.id);

    const takenTaskIds = await MarketplaceSubmission
      .find({ viewerUserId, holdsSlot: true }).distinct('taskId');

    const tasks = await MarketplaceTask.find({
      status: 'active',
      creatorUserId: { $ne: viewerUserId },
      _id: { $nin: takenTaskIds },
    }).select('-creatorUserId').sort({ createdAt: -1 }).limit(50);

    res.json({ tasks });
  } catch (err) {
    console.error('GET /marketplace/tasks failed', err.message);
    res.status(500).json({ error: 'Could not load tasks' });
  }
});

// ---------------- creator: my posts / delete / resume ----------------
router.get('/my-posts', validateInitData, async (req, res) => {
  try {
    const creatorUserId = Number(req.tgUser.id);
    const tasks = await MarketplaceTask.find({ creatorUserId, status: { $ne: 'deleted' } }).sort({ createdAt: -1 });
    res.json({ tasks });
  } catch (err) {
    console.error('GET /marketplace/my-posts failed', err.message);
    res.status(500).json({ error: 'Could not load your posts' });
  }
});

router.delete('/task/:id', validateInitData, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Bad id' });
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

router.post('/task/:id/resume', validateInitData, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Bad id' });
    const creatorUserId = Number(req.tgUser.id);
    const task = await MarketplaceTask.findOne({ _id: req.params.id, creatorUserId, status: 'paused' });
    if (!task) return res.status(404).json({ error: 'Task not found or not paused' });

    const creator = await User.findOne({ user_id: creatorUserId }).select('balance').lean();
    if (!creator || creator.balance < task.pointCost) {
      return res.status(400).json({ error: 'Not enough DASH balance to resume this task' });
    }

    task.status = 'active';
    task.pauseReason = null;
    await task.save();
    res.json({ success: true });
  } catch (err) {
    console.error('POST /marketplace/task/:id/resume failed', err.message);
    res.status(500).json({ error: 'Could not resume task' });
  }
});

// ---------------- viewer: start (server-side clock) ----------------
router.post('/start', validateInitData, async (req, res) => {
  try {
    const viewerUserId = Number(req.tgUser.id);
    const { taskId } = req.body;
    if (!mongoose.isValidObjectId(taskId)) return res.status(400).json({ error: 'Bad task' });

    const task = await MarketplaceTask.findOne({ _id: taskId, status: 'active' });
    if (!task) return res.status(404).json({ error: 'Task not found or no longer active' });
    if (task.creatorUserId === viewerUserId) return res.status(403).json({ error: 'You cannot do your own task.' });

    await MarketplaceStart.updateOne(
      { taskId, viewerUserId },
      { $setOnInsert: { startedAt: new Date() } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('POST /marketplace/start failed', err.message);
    res.status(500).json({ error: 'Could not start task' });
  }
});

// ---------------- viewer: submit proof ----------------
// cheap checks BEFORE the expensive VPN / hash / OCR steps
async function precheck(req, res, next) {
  try {
    const viewerUserId = Number(req.tgUser.id);
    if (!req.file) return res.status(400).json({ error: 'No screenshot uploaded' });
    if (!/^image\//.test(req.file.mimetype || '')) return res.status(400).json({ error: 'Please upload an image file.' });

    const { taskId } = req.body;
    if (!mongoose.isValidObjectId(taskId)) return res.status(400).json({ error: 'Bad task' });

    const task = await MarketplaceTask.findById(taskId);
    if (!task || task.status !== 'active') return res.status(404).json({ error: 'Task not found or no longer active' });
    if (task.creatorUserId === viewerUserId) return res.status(403).json({ error: 'You cannot submit proof for your own task.' });

    const existing = await MarketplaceSubmission.exists({ taskId, viewerUserId, holdsSlot: true });
    if (existing) return res.status(409).json({ error: 'You already submitted proof for this task.' });

    const start = await MarketplaceStart.findOne({ taskId, viewerUserId });
    if (!start) return res.status(400).json({ error: 'Open the task and tap "Start earning" first.' });

    req.mpTask = task;
    req.mpStart = start;
    next();
  } catch (err) {
    console.error('submit precheck failed', err.message);
    res.status(500).json({ error: 'Could not process submission' });
  }
}

router.post(
  '/submit',
  validateInitData,
  submitRateLimit,
  uploadScreenshot,
  precheck,
  checkVpn,
  fingerprintCheck,
  ocrStatsForNerds,
  async (req, res) => {
    const viewerUserId = Number(req.tgUser.id);
    const task = req.mpTask;
    const taskId = task._id;
    const startedAt = req.mpStart.startedAt;
    const vpn = req.vpnCheck;
    const fp = req.fingerprintCheck;
    const ocr = req.ocrResult;

    try {
      const rejectRecord = (reason) => MarketplaceSubmission.create({
        taskId, viewerUserId, taskStartedAt: startedAt,
        sha256: fp.sha256, pHash: fp.pHash,
        country: vpn.country, fraudScore: vpn.fraudScore,
        status: 'rejected', rejectionReason: reason, holdsSlot: false,
      });

      // 1. duplicate screenshot (any user, including the same one)
      if (fp.isDuplicate) {
        await rejectRecord(`duplicate_screenshot_${fp.matchType}`);
        return res.status(403).json({ error: 'This screenshot has already been used for a submission.' });
      }

      // 2. per-task country restriction
      if (task.allowedCountries.length > 0 && !task.allowedCountries.includes(vpn.country)) {
        return res.status(403).json({ error: 'This task is not available in your region.' });
      }

      // 3. hard VPN / fraud block
      if (vpn.action === 'block') {
        await rejectRecord('vpn_fraud_score_block');
        return res.status(403).json({ error: 'Submission blocked due to network security flag.' });
      }

      // 4. filename info (informational; device-local time can't be trusted vs server time)
      const info = parseScreenshotFilename(req.file.originalname || '');
      let filenameTimestampMatch = 'not_present';
      let filenameAppMatch = 'not_present';
      let filenameAppRaw = null;
      if (info.present) {
        const ts = info.timestamp instanceof Date ? info.timestamp.getTime() : NaN;
        if (!Number.isNaN(ts)) {
          const expected = startedAt.getTime() + task.watchDurationSeconds * 1000;
          filenameTimestampMatch = Math.abs(ts - expected) <= 5 * 60 * 1000 ? 'match' : 'mismatch';
        }
        filenameAppRaw = info.appName;
        const appLower = info.appName.toLowerCase();
        if (appLower.includes('youtube')) filenameAppMatch = 'youtube';
        else if (appLower.includes('chrome')) filenameAppMatch = 'chrome';
        else if (info.likelyEdited) filenameAppMatch = 'edited';
        else filenameAppMatch = 'other';
      }

      // 5. store screenshot
      const screenshotFileId = await uploadScreenshotToStorage(
        req.file.buffer,
        `Task:${taskId} Viewer:${viewerUserId}`
      );

      // 6. decide: auto-approve or manual review
      const screenshotOk = !ocr.error && ocr.videoId === task.videoId;
      const watchedEnough = !ocr.error && ocr.elapsedSeconds !== null && ocr.elapsedSeconds >= task.watchDurationSeconds;
      const timestampOk = Date.now() >= startedAt.getTime() + task.watchDurationSeconds * 1000; // server clock

      const reasons = [];
      if (vpn.action === 'review') reasons.push('vpn_review');
      if (ocr.error) reasons.push('ocr_error');
      else {
        if (!screenshotOk) reasons.push('video_id_mismatch');
        if (!watchedEnough) reasons.push('watch_time_short');
      }
      if (!timestampOk) reasons.push('too_fast');
      if (filenameAppMatch === 'edited') reasons.push('filename_edited');

      // 7. always create as pending; approveSubmission flips it atomically with the payout
      let submission;
      try {
        submission = await MarketplaceSubmission.create({
          taskId, viewerUserId, taskStartedAt: startedAt,
          screenshotFileId,
          filenameTimestampMatch, filenameAppMatch, filenameAppRaw,
          sha256: fp.sha256, pHash: fp.pHash,
          ocrVideoId: ocr.videoId, ocrElapsedSeconds: ocr.elapsedSeconds,
          country: vpn.country, fraudScore: vpn.fraudScore,
          status: 'pending_review', holdsSlot: true,
          flagReason: reasons.length ? reasons.join(',') : null,
        });
      } catch (e) {
        if (e.code === 11000) return res.status(409).json({ error: 'You already submitted proof for this task.' });
        throw e;
      }

      // register the fingerprint globally regardless of outcome
      try {
        await ScreenshotFingerprint.create({ sha256: fp.sha256, pHash: fp.pHash, userId: viewerUserId, taskId });
      } catch (e) {
        console.error('ScreenshotFingerprint.create failed:', e.message);
      }

      let status = 'pending_review';
      let reason = reasons.length ? 'needs_review' : null;

      if (reasons.length === 0) {
        try {
          const result = await approveSubmission(submission._id, null);
          if (result.approved) { status = 'approved'; reason = null; }
          else reason = result.reason;
        } catch (e) {
          console.error('auto approve failed (left pending):', e.message);
          reason = 'payout_delayed';
        }
      }

      // minimal response: booleans only, no raw OCR / fraud data
      res.json({
        success: true,
        status,
        reason,
        duplicateFlag: false,
        vpnBlocked: false,
        countryBlocked: false,
        screenshotOk,
        timeOk: watchedEnough && timestampOk,
      });
    } catch (err) {
      console.error('POST /marketplace/submit failed', err.message);
      res.status(500).json({ error: 'Could not process submission' });
    }
  }
);

// ---------------- viewer: my submissions ----------------
router.get('/my-submissions', validateInitData, async (req, res) => {
  try {
    const viewerUserId = Number(req.tgUser.id);
    const submissions = await MarketplaceSubmission.find({ viewerUserId })
      .select('taskId status rejectionReason createdAt')
      .populate('taskId', 'title thumbnailUrl videoId pointCost')
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ submissions });
  } catch (err) {
    console.error('GET /marketplace/my-submissions failed', err.message);
    res.status(500).json({ error: 'Could not load submissions' });
  }
});

module.exports = router;
