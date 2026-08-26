const mongoose = require('mongoose');

const ImageGenConfig = mongoose.model('ImageGenConfig', new mongoose.Schema({
    cost: { type: Number, default: 350 },
    dailyCap: { type: Number, default: 3 },
    updatedAt: { type: Date, default: Date.now }
}));

module.exports = ImageGenConfig;
