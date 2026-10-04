const { AdminActivity } = require('../models');

async function logAdminAction(adminUser, action, description, meta = {}) {
    try {
        await AdminActivity.create({
            admin_id: adminUser.id,
            admin_name: adminUser.first_name || adminUser.username || 'Admin',
            action,
            description,
            target_user_id: meta.target_user_id ?? null,
            changes: meta.changes || []
        });
    } catch (e) { console.error('Failed to log admin action:', e); }
}

module.exports = { logAdminAction };
