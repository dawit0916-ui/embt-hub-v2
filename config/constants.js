// Shared constants used across middleware, bot handlers, and routes.
// Keeping these in one place (instead of index.js) avoids circular
// requires, since middleware/ and routes/ both need `admins`.

const admins = process.env.ADMINS.split(',').map(id => parseInt(id));

const STORAGE_CHANNEL_ID = process.env.STORAGE_CHANNEL_ID;
const BOT_USERNAME = process.env.BOT_USERNAME || 'Dashearn_bot';
const CONFIG_CHANNEL_ID = -1003931137962; // private CMS channel
const PUBLIC_GROUP_ID = -1002352280130;   // your group
const PUBLIC_CHANNEL_ID = -1003473429839; // your channel

const PORT = process.env.PORT || 3000;

// AdsGram "task" widget block ID for the Fast Task feature. No admin UI for
// this on purpose — set it once here via env var and it's live everywhere.
// Get this ID from your AdsGram dashboard (Blocks section, "Task" format).
const FAST_TASK_ADSGRAM_BLOCK_ID = process.env.FAST_TASK_ADSGRAM_BLOCK_ID || null;

module.exports = {
    admins,
    STORAGE_CHANNEL_ID,
    CONFIG_CHANNEL_ID,
    PUBLIC_GROUP_ID,
    PUBLIC_CHANNEL_ID,
    BOT_USERNAME,
    PORT,
    FAST_TASK_ADSGRAM_BLOCK_ID,
};
