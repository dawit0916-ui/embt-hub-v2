const bot = require('../bot/bot'); // adjust path to wherever your Telegraf instance is exported
const { STORAGE_CHANNEL_ID } = require('../config/constants');

// Uploads a screenshot buffer to the storage channel, returns the Telegram file_id
async function uploadScreenshotToStorage(buffer, caption) {
  const message = await bot.telegram.sendPhoto(
    STORAGE_CHANNEL_ID,
    { source: buffer },
    { caption }
  );
  // photo is an array of sizes — take the largest
  const largest = message.photo[message.photo.length - 1];
  return largest.file_id;
}

// Resolves a file_id into a temporary Telegram-hosted URL for serving/display
async function getStorageFileUrl(fileId) {
  const link = await bot.telegram.getFileLink(fileId);
  return link.href; // valid for a limited time — don't persist this URL long-term, only the file_id
}

module.exports = { uploadScreenshotToStorage, getStorageFileUrl };
