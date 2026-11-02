const { User } = require('../models');

const RETENTION_DAYS = Number(process.env.HISTORY_RETENTION_DAYS) || 90;
const DAY_MS = 24 * 60 * 60 * 1000;

async function pruneHistory() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS);
  const result = await User.updateMany(
    { 'history.date': { $lt: cutoff } },
    { $pull: { history: { date: { $lt: cutoff } } } }
  );
  console.log(`[History cleanup] removed entries older than ${RETENTION_DAYS} days from ${result.modifiedCount} users`);
}

function startHistoryCleanup() {
  setTimeout(() => pruneHistory().catch((e) => console.error('[History cleanup] failed', e.message)), 60 * 1000);
  setInterval(() => pruneHistory().catch((e) => console.error('[History cleanup] failed', e.message)), DAY_MS);
}

module.exports = { startHistoryCleanup };
