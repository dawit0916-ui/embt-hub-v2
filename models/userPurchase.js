const mongoose = require('mongoose');


// UserPurchase: Track what users have bought
const UserPurchase = mongoose.model('UserPurchase', new mongoose.Schema({
    userId: { type: Number, required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShopProduct', required: true },
    type: { type: String, enum: ['course', 'apk', 'other'], required: true },
    price: { type: Number, required: true }, // Price paid (in DASH)
    purchasedAt: { type: Date, default: Date.now },
    accessExpiresAt: { type: Date, default: null }, // null = lifetime
    status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active' }
}));

module.exports = UserPurchase;
