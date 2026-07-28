const mongoose = require('mongoose');


const YoutubeTask = mongoose.model('YoutubeTask', new mongoose.Schema({
    id: { type: String, default: () => 'yt' + Math.floor(Math.random() * 1000000) },
    title: { type: String, required: true },
    instructions: { type: String, default: '' },     // shown to user before they watch
    youtubeUrl: { type: String, required: true },
    thumbnail: { type: String, default: '' },         // optional image/base64, same pattern as Task.image
    code: { type: String, required: true },            // hidden code, never sent to non-admin clients
    reward: { type: Number, required: true },
    enabled: { type: Boolean, default: true },
    claimedBy: [{ type: Number }],                      // array of user_id who already redeemed
    createdAt: { type: Date, default: Date.now }
}));

module.exports = YoutubeTask;
