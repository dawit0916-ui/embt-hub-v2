const { Settings } = require('../models');

// --- SETTINGS FETCHER ---
async function getSettings() {
    try {
        let s = await Settings.findOne();
        if (!s) {
            s = await Settings.create({
                min_withdraw: 0.2,
                ref_bonus: 0.1,
                penalty_fee: 0.1,
                withdrawals_enabled: true,
                maintenance_mode: false,
                ref_commission_percent: 10,
                ref_bonus_amount: 0.05
            });
        }
        return s;
    } catch (err) {
        console.error("Database Settings Error:", err);
        return null;
    }
}

module.exports = { getSettings };
