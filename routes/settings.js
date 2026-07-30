const express = require('express');
const router = express.Router();

const validateAdmin = require('../middleware/validateAdmin');
const { Settings } = require('../models');
const { getSettings } = require('../utils/settings');
const { logAdminAction } = require('../utils/logAdminAction');

router.post('/api/admin/settings', validateAdmin, async (req, res) => {
    try {
        await Settings.updateOne({}, { $set: req.body });
        await logAdminAction(req.adminUser, 'settings_updated', `Updated: ${Object.keys(req.body).join(', ')}`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/settings', async (req, res) => res.json(await getSettings()));

// Admin panel's settings loader calls this on open — was previously missing
// entirely (404), so the admin Settings panel silently never loaded real
// values (ref-threshold, maintenance state, etc. all stayed at whatever
// the raw HTML placeholder showed).
router.get('/api/admin/settings/all', validateAdmin, async (req, res) => {
    try {
        const settings = await getSettings();
        res.json({ success: true, settings });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/settings/update', validateAdmin, async (req, res) => { await Settings.updateOne({}, req.body); res.json({ success: true }); });

module.exports = router;
