const { AdminActivity } = require('../models');

async function logAdminAction(adminUser, action, description) {
    try {
        await AdminActivity.create({
            admin_id: adminUser.id,
            admin_name: adminUser.first_name || adminUser.username || 'Admin',
            action,
            description
        });
    } catch (e) { console.error('Failed to log admin action:', e); }
}

module.exports = { logAdminAction };
