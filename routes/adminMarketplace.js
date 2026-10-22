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

    const url = await getStorageFileUrl(sub.screenshotFileId); // server-side only
    const upstream = await fetch(url);
    if (!upstream.ok) return res.sendStatus(502);

    res.set({
      'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'private, max-age=300',
    });
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('GET /admin/marketplace/screenshot failed', err.message);
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

    const out = submissions.map((s) => ({
      ...s,
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
