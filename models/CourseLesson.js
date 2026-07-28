const mongoose = require('mongoose');


// CourseLesson: Individual lessons/modules within a course
const CourseLesson = mongoose.model('CourseLesson', new mongoose.Schema({
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShopProduct', required: true, index: true },
    moduleName: { type: String, required: true },  // "Module 1: Getting Started"
    lessonName: { type: String, required: true },  // "Setting Up Your Account"
    videoUrl: { type: String, default: '' },       // Fallback URL
    telegram_file_id: { type: String, default: '' }, // CRITICAL: Telegram's secure file ID
    duration: { type: String, default: '0:00' },   // "12:45"
    order: { type: Number, default: 0 },           // Sort order within course
    telegramMessageId: { type: Number, default: null }, // Where it was posted in storage channel
    createdAt: { type: Date, default: Date.now }
}));

module.exports = CourseLesson;
