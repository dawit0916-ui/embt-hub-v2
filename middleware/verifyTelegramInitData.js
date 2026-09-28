const crypto = require('crypto');

// How long a signed initData stays valid after Telegram issued it.
// Telegram only refreshes it when the app is relaunched, so keep this
// generous enough for normal sessions.
const MAX_AGE_SECONDS = 24 * 60 * 60;

// ==========================================================================
// SHARED TELEGRAM INIT DATA VERIFICATION
// Used by both validateInitData and validateAdmin.
// ==========================================================================
function verifyTelegramInitData(rawInitData) {
    if (!rawInitData) return null;

    try {
        const cleanInitData = rawInitData.startsWith('tma ')
            ? rawInitData.substring(4)
            : rawInitData.startsWith('Bearer ')
                ? rawInitData.substring(7)
                : rawInitData;

        const urlParams = new URLSearchParams(cleanInitData);
        const hash = urlParams.get('hash');
        if (!hash) return null;
        urlParams.delete('hash');

        const dataCheckArr = [];
        for (const [key, value] of urlParams.entries()) {
            dataCheckArr.push(`${key}=${value}`);
        }
        dataCheckArr.sort();
        const dataCheckString = dataCheckArr.join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
        const calculatedHmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        // Constant-time signature comparison
        const a = Buffer.from(calculatedHmac, 'hex');
        const b = Buffer.from(hash, 'hex');
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

        // Reject stale (or future-dated) initData
        const authDate = Number(urlParams.get('auth_date'));
        const age = Math.floor(Date.now() / 1000) - authDate;
        if (!authDate || age > MAX_AGE_SECONDS || age < -60) return null;

        const userRaw = urlParams.get('user');
        return userRaw ? JSON.parse(userRaw) : null;
    } catch (err) {
        console.error("[Auth Parsing Error Stack]:", err.message);
        return null;
    }
}

module.exports = verifyTelegramInitData;
