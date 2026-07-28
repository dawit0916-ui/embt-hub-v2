const mongoose = require('mongoose');

// =====================================================
// SHOP SYSTEM - MODELS
// =====================================================

// ShopProduct: Courses, APKs, etc.
const ShopProduct = mongoose.model('ShopProduct', new mongoose.Schema({
    type: { type: String, enum: ['course', 'apk', 'other'], required: true },
    title: { type: String, required: true },
    category: { type: String, default: 'General' },
    description: { type: String, default: '' },
    price: { type: Number, required: true },
    thumbnail: { type: String, default: '' },
    rating: { type: Number, default: 0 },
    reviews: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    createdBy: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },

    // Added for APK products
    telegram_file_id: { type: String, default: null }, // needed to deliver the APK on purchase
    fileName: { type: String, default: null },
    fileSize: { type: String, default: null }
}));

module.exports = ShopProduct;
