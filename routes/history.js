const express = require('express');
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const { User } = require('../models');

router.get('/api/secure/history', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const user = await User.findOne({ user_id: userId }).lean();
        if (!user) return res.status(404).json({ error: "User not found." });

        const history = (user.history || [])
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 50);

        return res.json({ success: true, history });
    } catch (err) {
        console.error("History fetch error:", err);
        return res.status(500).json({ error: "Failed to load history." });
    }
});

module.exports = router;
