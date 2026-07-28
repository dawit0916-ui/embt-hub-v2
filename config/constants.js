// Shared constants used across middleware, bot handlers, and routes.
// Keeping these in one place (instead of index.js) avoids circular
// requires, since middleware/ and routes/ both need `admins`.

const admins = process.env.ADMINS.split(',').map(id => parseInt(id));

const STORAGE_CHANNEL_ID = process.env.STORAGE_CHANNEL_ID;

const CONFIG_CHANNEL_ID = -1003931137962; // private CMS channel
const PUBLIC_GROUP_ID = -1002352280130;   // your group
const PUBLIC_CHANNEL_ID = -1003473429839; // your channel

const PORT = process.env.PORT || 3000;

module.exports = {
    admins,
    STORAGE_CHANNEL_ID,
    CONFIG_CHANNEL_ID,
    PUBLIC_GROUP_ID,
    PUBLIC_CHANNEL_ID,
    PORT,
};
