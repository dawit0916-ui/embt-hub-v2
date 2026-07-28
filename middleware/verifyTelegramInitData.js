const crypto = require('crypto');

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
        urlParams.delete('hash');

        const dataCheckArr = [];
        for (const [key, value] of urlParams.entries()) {
            dataCheckArr.push(`${key}=${value}`);
        }
        dataCheckArr.sort();
        const dataCheckString = dataCheckArr.join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
        const calculatedHmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (calculatedHmac !== hash) return null;

        const userRaw = urlParams.get('user');
        return userRaw ? JSON.parse(userRaw) : null;
    } catch (err) {
        console.error("[Auth Parsing Error Stack]:", err.message);
        return null;
    }
}

module.exports = verifyTelegramInitData;
