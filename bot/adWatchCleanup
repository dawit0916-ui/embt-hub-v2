const { AdWatch } = require('../models');

// Replaces the old TTL index on AdWatch.createdAt (removed from the model —
// see the comment there for why). That TTL blanket-deleted every watch
// record after 10 minutes, which also destroyed claimed/completed records
// needed to enforce each ad's admin-configured resetIntervalHours limit.
//
// This does the same cleanup job the TTL was actually meant for — clearing
// out sessions that were started but never finished — without touching
// anything that was actually claimed. Claimed records are left alone
// permanently (correct, since some ads reset only every 24h+ and need
// their history to survive that whole period).
async function cleanupAbandonedAdWatches() {
    try {
        const abandonedCutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour
        const result = await AdWatch.deleteMany({
            claimed: false,
            createdAt: { $lt: abandonedCutoff }
        });
        if (result.deletedCount > 0) {
            console.log(`[AdWatch Cleanup] Removed ${result.deletedCount} abandoned (never-claimed) session(s)`);
        }
    } catch (err) {
        console.error('[AdWatch Cleanup Error]:', err.message);
    }
}

setInterval(cleanupAbandonedAdWatches, 30 * 60 * 1000); // every 30 minutes
cleanupAbandonedAdWatches(); // also run once on startup

module.exports = { cleanupAbandonedAdWatches };
