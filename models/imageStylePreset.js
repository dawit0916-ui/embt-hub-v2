const mongoose = require('mongoose');

const ImageStylePreset = mongoose.model('ImageStylePreset', new mongoose.Schema({
    styleId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    promptTemplate: { type: String, required: true },
    previewThumbnail: { type: String, default: '' }, // filename in assets/thumbnails/, same convention as ShopProduct.thumbnail
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
}));

module.exports = ImageStylePreset;
