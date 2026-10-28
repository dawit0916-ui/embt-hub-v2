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
const ALLOWED_PROOF_APPS = ['youtube', 'chrome', 'safari'];
const REJECTION_WINDOW_MS = 24 * 60 * 60 * 1000;

// OCR often confuses o/0 and i/l/1 and letter case, so compare IDs in a lookalike-safe form
const CONFUSABLE = {
  o: '0', d: '0', i: '1', l: '1', '|': '1', '!': '1',
  s: '5', b: '8', g: '9', q: '9', z: '2', v: 'u',
};
function normId(s) {
  return [...String(s || '').toLowerCase()].map((c) => CONFUSABLE[c] || c).join('');
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

// true if the expected ID appears in the OCR output, allowing up to 2 misread characters
function videoIdMatchesOcr(expected, ocr) {
  const target = normId(expected);
  const raw = String(ocr.rawText || '');
  const cands = [ocr.videoId, ...(raw.match(/[A-Za-z0-9_-]{8,14}/g) || [])];
  if (cands.some((c) => c && editDistance(normId(c), target) <= 2)) return true;
  // last resort: ignore spaces/labels and slide a window over the whole text
  const flat = normId(raw.replace(/[^A-Za-z0-9_-]/g, ''));
  for (let len = target.length - 1; len <= target.length + 1; len++) {
    for (let i = 0; i + len <= flat.length; i++) {
      if (editDistance(flat.slice(i, i + len), target) <= 2) return true;
    }
  }
  return false;
}
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
function parseIsoDuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
  if (!m) return null;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

// Video length in seconds, or null if it can't be found
async function getYoutubeDuration(videoId) {
  try {
    if (process.env.YOUTUBE_API_KEY) {
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoId}&key=${process.env.YOUTUBE_API_KEY}`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (r.ok) {
        const d = await r.json();
        const seconds = parseIsoDuration(d.items && d.items[0] && d.items[0].contentDetails.duration);
        if (seconds !== null) return seconds;
      }
    }
    // fallback: read the length from the public watch page
    const r2 = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'accept-language': 'en-US,en;q=0.9', 'user-agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' },
      signal: AbortSignal.timeout(5000),
    });
    if (r2.ok) {
      const html = await r2.text();
      const m = /"lengthSeconds":"(\d+)"/.exec(html);
      if (m) return Number(m[1]);
    }
  } catch (err) {
    console.error('getYoutubeDuration error:', err.message);
  }
  return null;
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
        // the video must be at least as long as the watch time the creator chose
    const videoSeconds = await getYoutubeDuration(videoId);
    if (videoSeconds !== null && videoSeconds < duration) {
      return res.status(400).json({
        error: `This video is only ${videoSeconds} seconds long, shorter than the ${Math.round(duration / 60)} minute watch time. Pick a longer video or a shorter watch time.`,
      });
}

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
        if (task.pauseReason === 'video_too_short') {
      return res.status(400).json({ error: 'This video is shorter than the watch time. Delete this task and post it again with a shorter watch time or a longer video.' });
    }

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

    // Country check BEFORE the modal opens (lookup only runs for country-restricted tasks)
    if (task.allowedCountries.length > 0) {
      await new Promise((resolve) => checkVpn(req, res, resolve));
      const country = req.vpnCheck && req.vpnCheck.country;

      if (!country) {
        return res.status(503).json({
          error: "Couldn't verify your country right now. Please try again in a moment.",
          reason: 'country_unverified',
        });
      }
      if (!task.allowedCountries.includes(country)) {
        return res.status(403).json({
          error: `Country didn't match. This task is only for: ${task.allowedCountries.join(', ')}.`,
          reason: 'country_mismatch',
        });
      }
    }

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

        const msLeft = start.startedAt.getTime() + task.watchDurationSeconds * 1000 - Date.now();
    if (msLeft > 0) {
      return res.status(400).json({ error: `Keep watching: about ${Math.ceil(msLeft / 1000)} seconds left before you can submit proof.` });
    }

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
      const baseDoc = {
        taskId, viewerUserId, taskStartedAt: startedAt,
        sha256: fp.sha256, pHash: fp.pHash,
        country: vpn.country,
      };

      // 1. duplicate screenshot (any user, including the same one)
      if (fp.isDuplicate) {
        await MarketplaceSubmission.create({
          ...baseDoc, status: 'rejected', rejectionReason: `duplicate_screenshot_${fp.matchType}`, holdsSlot: false,
        });
        return res.status(403).json({ error: 'This screenshot has already been used for a submission.' });
      }

      // 2. per-task country restriction (same rule as /start, kept as a safety net)
      if (task.allowedCountries.length > 0) {
        if (!vpn.country) {
          return res.status(503).json({ error: "Couldn't verify your country right now. Please try again in a moment." });
        }
        if (!task.allowedCountries.includes(vpn.country)) {
          return res.status(403).json({ error: "Country didn't match. This task is not available in your region." });
        }
      }

      // 3. OCR verdict
      const required = task.watchDurationSeconds;
      const idFound = !ocr.error && videoIdMatchesOcr(task.videoId, ocr);
      const idRead = !ocr.error && (ocr.videoId !== null || idFound);
      const idMatches = idFound;
      if (!ocr.error && !idFound) {
        console.log('[ocr id_not_found]', { expected: task.videoId, read: ocr.videoId, raw: String(ocr.rawText || '').slice(0, 400) });
      }
      if (idRead && !idMatches) {
        console.log('[ocr wrong_video]', { expected: task.videoId, read: ocr.videoId, raw: String(ocr.rawText || '').slice(0, 300) });
      }
      const timeRead = !ocr.error && ocr.elapsedSeconds !== null;
      const timeEnough = timeRead && ocr.elapsedSeconds >= required;
            // the task asks for more time than the video has: not the viewer's fault
      const videoTooShort = !ocr.error && ocr.totalSeconds !== null && ocr.totalSeconds < required;
      if (videoTooShort && idMatches && task.status === 'active') {
        // the real video is shorter than the watch time: stop sending viewers to an impossible task
        await MarketplaceTask.updateOne({ _id: taskId, status: 'active' }, { status: 'paused', pauseReason: 'video_too_short' });
      }

      // 3a. AUTO-REJECT: OCR worked, and the proof is clearly wrong
      let autoReject = null;
      if (!ocr.error) {
        if (!idRead && !timeRead) {
          autoReject = {
            reason: 'no_stats_overlay',
            message: "We couldn't read Stats for Nerds in your screenshot. Turn it on, keep it visible, and take a clear screenshot while the video plays.",
          };
        } else if (idRead && !idMatches) {
          autoReject = {
            reason: 'wrong_video',
            message: 'This screenshot shows a different video. Watch the task video and try again.',
          };
       } else if (timeRead && !timeEnough && !videoTooShort) {
          autoReject = {
            reason: 'not_enough_watch_time',
            message: `The screenshot shows less than the required ${Math.round(required / 60)} minutes. Keep watching, then take the screenshot.`,
          };
        }
      }

      if (autoReject) {
        await MarketplaceSubmission.create({
          ...baseDoc,
          ocrVideoId: ocr.videoId, ocrElapsedSeconds: ocr.elapsedSeconds,
          status: 'rejected', rejectionReason: autoReject.reason, holdsSlot: false,
        });
        // fingerprint is NOT registered here, so an honest retake is never flagged as a duplicate
        return res.json({
          success: false,
          status: 'rejected',
          reason: autoReject.reason,
          message: autoReject.message,
          duplicateFlag: false,
          vpnBlocked: false,
          countryBlocked: false,
          screenshotOk: idMatches,
          timeOk: timeEnough,
        });
      }

      // 4. filename app (Android screenshots are named after the app on screen)
      const info = parseScreenshotFilename(req.file.originalname || '');
      let filenameAppMatch = 'not_present';
      let filenameAppRaw = null;
      if (info.present) {
        filenameAppRaw = info.appName;
        const appLower = info.appName.toLowerCase();
        const allowedApp = ALLOWED_PROOF_APPS.find((a) => appLower.includes(a));
        if (allowedApp) filenameAppMatch = allowedApp;
        else if (info.likelyEdited) filenameAppMatch = 'edited';
        else filenameAppMatch = 'other';
      }

      // 5. viewer history: any rejection in the last 24h means no auto-approve
      const recentRejections = await MarketplaceSubmission.countDocuments({
        viewerUserId,
        status: 'rejected',
        createdAt: { $gte: new Date(Date.now() - REJECTION_WINDOW_MS) },
        rejectionReason: { $nin: ['expired', 'task_missing', 'duplicate_cleanup', 'task_problem'] },
      });

      // 6. store screenshot (only proofs that reach a decision)
      const screenshotFileId = await uploadScreenshotToStorage(
        req.file.buffer,
        `Task:${taskId} Viewer:${viewerUserId}`
      );

      // 7. everything below goes to manual review
      const reasons = [];
      if (ocr.error) reasons.push('ocr_error');
      else {
        if (!idRead) reasons.push('video_id_unreadable');
        if (!timeRead) reasons.push('time_unreadable');
      }
      if (filenameAppMatch === 'edited') reasons.push('filename_edited');
      if (filenameAppMatch === 'other') reasons.push('filename_app_other');
      if (recentRejections > 0) reasons.push('recent_rejection');
      if (videoTooShort) reasons.push('video_shorter_than_task');

      // 8. always create as pending; approveSubmission flips it atomically with the payout
      let submission;
      try {
        submission = await MarketplaceSubmission.create({
          ...baseDoc,
          screenshotFileId,
          filenameAppMatch, filenameAppRaw,
          ocrVideoId: ocr.videoId, ocrElapsedSeconds: ocr.elapsedSeconds,
          status: 'pending_review', holdsSlot: true,
          flagReason: reasons.length ? reasons.join(',') : null,
        });
      } catch (e) {
        if (e.code === 11000) return res.status(409).json({ error: 'You already submitted proof for this task.' });
        throw e;
      }

      // register the fingerprint for every proof that reaches a decision
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

      res.json({
        success: true,
        status,
        reason,
        duplicateFlag: false,
        vpnBlocked: false,
        countryBlocked: false,
        screenshotOk: idMatches,
        timeOk: timeEnough || videoTooShort,
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
