const mongoose = require('mongoose');


const Ticket = mongoose.model('Ticket', new mongoose.Schema({
    user_id: Number,
    username: String,
    subject: String,
    message: String,
    admin_reply: String,
    status: { type: String, default: 'open' }, 
    created_at: { type: Date, default: Date.now },
    ticket_id: { type: String, default: () => 'TKT-' + crypto.randomBytes(4).toString('hex').toUpperCase() },
    channel_message_id: { type: Number, default: null }
}));

module.exports = Ticket;
