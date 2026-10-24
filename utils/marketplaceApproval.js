const mongoose = require('mongoose');
const { User, MarketplaceTask, MarketplaceSubmission } = require('../models');
const bot = require('../bot/bot');
const { MARKETPLACE_PENDING_EXPIRY_DAYS } = require('../config/constants');

class NotPending extends Error {}
class TaskMissing extends Error {}
class InsufficientBalance extends Error {}

async function notify(userId, text) {
  try { await bot.telegram.sendMessage(userId, text); } catch (_) { /* user blocked the bot, etc. */ }
}

function reviewerFields(reviewer) {
  return { reviewedBy: reviewer ? Number(reviewer.id) : null, reviewedAt: new Date() };
}

// Atomic approve + payout. Safe against double taps, parallel admins and overdraw.
async function approveSubmission(submissionId, reviewer = null) {
  const session = await mongoose.startSession();
  let paid = null;

  try {
    await session.withTransaction(async () => {
      paid = null;

      const sub = await MarketplaceSubmission
        .findOne({ _id: submissionId, status: 'pending_review' }).session(session);
      if (!sub) throw new NotPending();

      const task = await MarketplaceTask.findById(sub.taskId).session(session);
      if (!task) throw new TaskMissing();

      // 1. flip status first, conditionally (only one caller can win)
      const flip = await MarketplaceSubmission.updateOne(
        { _id: sub._id, status: 'pending_review' },
        { status: 'approved', holdsSlot: true, flagReason: null, rejectionReason: null, ...reviewerFields(reviewer) },
        { session }
      );
      if (flip.modifiedCount !== 1) throw new NotPending();

      // 2. debit creator only if the balance covers it (atomic check + decrement)
      const debit = await User.updateOne(
        { user_id: task.creatorUserId, balance: { $gte: task.pointCost } },
        { $inc: { balance: -task.pointCost } },
        { session }
      );
      if (debit.modifiedCount !== 1) throw new InsufficientBalance();

      // 3. credit viewer
      const credit = await User.updateOne(
        { user_id: sub.viewerUserId },
        { $inc: { balance: task.pointCost } },
        { session }
      );
      if (credit.matchedCount !== 1) throw new Error('viewer_missing');

      // 4. task counters
      await MarketplaceTask.updateOne(
        { _id: task._id },
        { $inc: { viewsApproved: 1, dashSpent: task.pointCost } },
        { session }
      );

      paid = { viewerUserId: sub.viewerUserId, amount: task.pointCost };
    });
  } catch (err) {
    if (err instanceof NotPending) return { approved: false, reason: 'not_pending' };

    if (err instanceof TaskMissing) {
      await rejectSubmission(submissionId, 'task_missing', reviewer);
      return { approved: false, reason: 'task_missing' };
    }

    if (err instanceof InsufficientBalance) {
      // transaction rolled back; record the flag + pause the task outside it
      const sub = await MarketplaceSubmission.findById(submissionId).select('taskId');
      if (sub) {
        await MarketplaceTask.updateOne(
          { _id: sub.taskId, status: 'active' },
          { status: 'paused', pauseReason: 'insufficient_balance' }
        );
      }
      await MarketplaceSubmission.updateOne(
        { _id: submissionId, status: 'pending_review' },
        { flagReason: 'creator_insufficient_balance' }
      );
      return { approved: false, reason: 'creator_balance_insufficient' };
    }

    throw err;
  } finally {
    session.endSession();
  }

  if (!paid) return { approved: false, reason: 'not_pending' };

  await notify(paid.viewerUserId, `✅ Your task proof was approved! +${paid.amount} DASH added to your balance.`);
  return { approved: true, viewerUserId: paid.viewerUserId, amount: paid.amount };
}

async function rejectSubmission(submissionId, reason, reviewer = null) {
  const clean = String(reason || 'manual_admin_reject').slice(0, 200);
  const sub = await MarketplaceSubmission.findOneAndUpdate(
    { _id: submissionId, status: 'pending_review' },
    { status: 'rejected', rejectionReason: clean, holdsSlot: false, ...reviewerFields(reviewer) },
    { new: true }
  );
  if (!sub) return { rejected: false, reason: 'not_pending' };

  await notify(
    sub.viewerUserId,
    clean === 'task_problem'
      ? '⚠️ This task had a problem on our side, not yours. It will not count against you.'
      : `❌ Your task proof was rejected: ${clean.replace(/_/g, ' ')}.`
  );
  return { rejected: true, viewerUserId: sub.viewerUserId };
}

// Hourly job: auto-reject stale pending submissions
async function expireStalePending() {
  const cutoff = new Date(Date.now() - MARKETPLACE_PENDING_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const stale = await MarketplaceSubmission
    .find({ status: 'pending_review', createdAt: { $lt: cutoff } })
    .select('_id').limit(200);
  for (const s of stale) await rejectSubmission(s._id, 'expired', null);
}

module.exports = { approveSubmission, rejectSubmission, expireStalePending };
