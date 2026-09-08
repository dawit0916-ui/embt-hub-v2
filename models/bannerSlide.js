// models/bannerSlide.js
const mongoose = require('mongoose');

const bannerSlideSchema = new mongoose.Schema({
  imageUrl: { type: String, required: true },      // 16:9 image, e.g. 1200x675
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  order: { type: Number, default: 0 },              // display order
  isActive: { type: Boolean, default: true },
  clickCount: { type: Number, default: 0 },
  resetClicksAt: { type: Date, default: null },
  actionType: {
     type: String,
     enum: ['tab', 'shop-section', 'earn-section', 'url', 'none'],
     default: 'none'
  },
  actionTarget: { type: String, default: '' },       // e.g. "shop", "earn", "https://..."
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('BannerSlide', bannerSlideSchema);
