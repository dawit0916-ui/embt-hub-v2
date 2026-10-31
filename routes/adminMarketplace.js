const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Readable } = require('stream');
const router = express.Router();

const validateAdmin = require('../middleware/validateAdmin');
const { MarketplaceSubmission } = require('../models');
const { getStorageFileUrl } = require('../utils/telegramStorage');
const { approveSubmission, rejectSubmission } = require('../utils/marketplaceApproval');
const { logAdminAction } = require('../utils/logAdminAction');

// ---- signed, short-lived screenshot links (so the bot token never reaches the browser) ----
function signShot(id, exp) {
  return crypto.createHmac('sha256', process.env.BOT_TOKEN).update(`${id}.${exp}`).digest('hex');
}
function shotPath(id) {
  const exp = Date.now() + 10 * 60 * 1000;
  return `/api/admin/marketplace/screenshot/${id}?exp=${exp}&sig=${signShot(id, exp)}`;
}

async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw last;
}

router.get('/screenshot/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const exp = Number(req.query.exp);
    const sig = String(req.query.sig || '');
    if (!mongoose.isValidObjectId(id) || !exp || Date.now() > exp) return res.sendStatus(403);

    const expected = signShot(id, exp);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(403);

    const sub = await MarketplaceSubmission.findById(id).select('screenshotFileId');
    if (!sub || !sub.screenshotFileId) return res.sendStatus(404);

      const upstream = await withRetry(async () => {
      const url = await getStorageFileUrl(sub.screenshotFileId); // server-side only
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    });

    res.set({
      'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'private, max-age=300',
    });
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('GET /admin/marketplace/screenshot failed', err.message, err.cause && err.cause.code);
    res.sendStatus(500);
  }
});

// ---- review queue ----
router.get('/pending', validateAdmin, async (req, res) => {
  try {
    const submissions = await MarketplaceSubmission.find({ status: 'pending_review' })
      .sort({ createdAt: 1 })
      .populate('taskId', 'title videoId watchDurationSeconds pointCost status')
      .limit(100)
      .lean();

    // approved / rejected counts for every viewer in the queue
    const viewerIds = [...new Set(submissions.map((s) => s.viewerUserId))];
    const history = await MarketplaceSubmission.aggregate([
      { $match: { viewerUserId: { $in: viewerIds }, status: { $in: ['approved', 'rejected'] } } },
      { $group: { _id: { v: '$viewerUserId', s: '$status' }, n: { $sum: 1 } } },
    ]);
    const hist = {};
    history.forEach((h) => {
      hist[h._id.v] = hist[h._id.v] || { approved: 0, rejected: 0 };
      hist[h._id.v][h._id.s] = h.n;
    });

    const out = submissions.map((s) => ({
      ...s,
      viewerHistory: hist[s.viewerUserId] || { approved: 0, rejected: 0 },
      secondsSinceStart: s.taskStartedAt
        ? Math.round((new Date(s.createdAt) - new Date(s.taskStartedAt)) / 1000)
        : null,
      screenshotViewUrl: s.screenshotFileId ? shotPath(s._id) : null,
    }));
    res.json({ submissions: out });
  } catch (err) {
    console.error('GET /admin/marketplace/pending failed', err.message);
    res.status(500).json({ error: 'Could not load review queue' });
  }
});

const APPROVE_MESSAGES = {
  not_pending: 'Already resolved by someone else.',
  creator_balance_insufficient: 'Creator balance too low. Task paused; approve again after they top up.',
  task_missing: 'Task no longer exists. Submission was rejected.',
};

router.post('/viewer/:userId/clear-rejections', validateAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isSafeInteger(userId)) return res.status(400).json({ error: 'Bad user id' });

    const result = await MarketplaceSubmission.deleteMany({
      viewerUserId: userId,
      status: 'rejected',
    });

    await logAdminAction(
      req.adminUser,
      'marketplace_clear_rejections',
      `Cleared ${result.deletedCount} rejected marketplace submissions for ${userId}`,
      { target_user_id: userId }
    );
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    console.error('POST /admin/marketplace/viewer/:userId/clear-rejections failed', err.message);
    res.status(500).json({ error: 'Could not clear rejections' });
  }
});

router.post('/:id/approve', validateAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Bad id' });

    const result = await approveSubmission(req.params.id, req.adminUser);
    if (!result.approved) {
      return res.status(409).json({
        error: APPROVE_MESSAGES[result.reason] || 'Could not approve',
        reason: result.reason,
      });
    }

    await logAdminAction(
      req.adminUser,
      'marketplace_approve',
      `Approved marketplace submission ${req.params.id} (+${result.amount} DASH to ${result.viewerUserId})`,
      { target_user_id: result.viewerUserId }
    );
    res.json({ success: true, result });
  } catch (err) {
    console.error('POST /admin/marketplace/:id/approve failed', err.message);
    res.status(500).json({ error: 'Approval failed' });
  }
});

router.post('/:id/reject', validateAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Bad id' });

    const reason = typeof req.body.reason === 'string' ? req.body.reason : 'manual_admin_reject';
    const result = await rejectSubmission(req.params.id, reason, req.adminUser);
    if (!result.rejected) return res.status(409).json({ error: APPROVE_MESSAGES.not_pending, reason: 'not_pending' });

    await logAdminAction(
      req.adminUser,
      'marketplace_reject',
      `Rejected marketplace submission ${req.params.id} (${reason})`,
      { target_user_id: result.viewerUserId }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('POST /admin/marketplace/:id/reject failed', err.message);
    res.status(500).json({ error: 'Rejection failed' });
  }
});

module.exports = router;
