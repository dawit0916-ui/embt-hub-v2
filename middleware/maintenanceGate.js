// ==========================================================================
// UNIFIED ARCHITECTURAL MAINTENANCE INTERCEPTOR LAYER
// ==========================================================================

const ARCHITECTURAL_MAINTENANCE_CONFIG = {
    get enabled() { return process.env.MAINTENANCE_ENABLED === 'true'; },
    get bypassIds() {
        return (process.env.MAINTENANCE_BYPASS_IDS || '')
            .split(',')
            .map(id => Number(id.trim()))
            .filter(id => !isNaN(id));
    },
    get metadata() {
        try {
            return JSON.parse(process.env.MAINTENANCE_METADATA || '{}');
        } catch (e) {
            return {
                message: "System upgrading. Please check back shortly.",
                targetTime: Date.now() + 3600000,
                accentAsset: "🛠️"
            };
        }
    }
};

async function enforceGlobalMaintenanceGate(req, res, next) {
    // 1. If maintenance mode is disabled in environment settings, pass control to next handler instantly
    if (!ARCHITECTURAL_MAINTENANCE_CONFIG.enabled) {
        return next();
    }

    // 2. Dynamic multi-token parsing engine (Resolves both your structural Auth strategies)
    let extractedTelegramId = null;

    if (req.tgUser && req.tgUser.id) {
        // Strategy A: Catches requests matching pre-routed validateInitData layers
        extractedTelegramId = Number(req.tgUser.id);
    } else {
        // Strategy B Fix: Universal safe fallback data parse
        try {
            const rawAuthHeaderDataString = req.headers['x-telegram-init-data'];
            if (rawAuthHeaderDataString) {
                // Strip out 'tma ' if it exists, otherwise use the raw header string directly
                const cleanRawDataString = rawAuthHeaderDataString.startsWith('tma ')
                    ? rawAuthHeaderDataString.substring(4)
                    : rawAuthHeaderDataString;

                const urlParams = new URLSearchParams(cleanRawDataString);
                const userRaw = urlParams.get('user');
                if (userRaw) {
                    const parsed = JSON.parse(userRaw);
                    extractedTelegramId = Number(parsed.id);
                }
            }
        } catch (err) {
            // Drop execution through to safety evaluation blocks
        }
    }

    // 3. Evaluate authorized tester bypass lists safely
    if (extractedTelegramId && ARCHITECTURAL_MAINTENANCE_CONFIG.bypassIds.includes(extractedTelegramId)) {
        console.log(`[Maintenance Bypass] Authorized access permitted for tester: ${extractedTelegramId}`);
        return next();
    }

    // 4. Reject all standard users with an HTTP 503 containing telemetry properties
    return res.status(503).json({
        maintenance: true,
        serverTime: Date.now(),
        ...ARCHITECTURAL_MAINTENANCE_CONFIG.metadata
    });
}

module.exports = enforceGlobalMaintenanceGate;
