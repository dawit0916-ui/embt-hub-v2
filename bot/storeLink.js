// Adds the /linkstore command: gives the user a one-time code to link the store app.
// Must be required BEFORE ./handlers so this command is matched first.
const bot = require('./bot');

let store = null;
module.exports.setStore = (s) => { store = s; };

bot.command('linkstore', async (ctx) => {
    try {
        if (ctx.chat?.type !== 'private') {
            return ctx.reply('Please send /linkstore to me in a private chat.');
        }
        if (!store) return ctx.reply('The store is not available right now. Try again in a minute.');
        const { code, expiresInSec } = await store.createLinkCode(ctx.from.id);
        await ctx.reply(
            `🔐 Store link code:\n\n<code>${code}</code>\n\n` +
            `Enter it in the store app. It works once and expires in ${Math.round(expiresInSec / 60)} minutes. Never share it.`,
            { parse_mode: 'HTML' }
        );
    } catch (e) {
        console.error('[store] /linkstore failed:', e.message);
        await ctx.reply(e.status === 403 ? 'This account cannot use the store.' : 'Could not create a code. Press /start first, then try again.');
    }
});
