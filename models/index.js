// Re-exports every model so routes can do:
//   const { User, Task } = require('../models');

const User = require('./user');
const ReferralEarning = require('./referralEarning');
const Settings = require('./settings');
const Ticket = require('./ticket');
const Task = require('./task');
const ProofSubmission = require('./proofSubmission');
const AdminActivity = require('./adminActivity');
const AdWatch = require('./adWatch');
const DailyTaskProgress = require('./dailyTaskProgress');
const ActiveAd = require('./activeAd');
const YoutubeTask = require('./youtubeTask');
const TelegramVerification = require('./telegramVerification');
const ReminderConfig = require('./reminderConfig');
const UserReminder = require('./userReminder');
const LevelConfig = require('./levelConfig');
const FeatureUsageLog = require('./featureUsageLog');
const PendingReaction = require('./pendingReaction');
const CompletedTask = require('./completedTask');
const ShopProduct = require('./shopProduct');
const CourseLesson = require('./courseLesson');
const UserPurchase = require('./userPurchase');
const ImageStylePreset = require('./imageStylePreset');
const ImageGenLog = require('./imageGenLog');
const ImageGenConfig = require('./imageGenConfig');
const BannerSlide = require('./bannerSlide');
const MarketplaceTask = require('./marketplaceTask');
const MarketplaceSubmission = require('./marketplaceSubmission');
const ScreenshotFingerprint = require('./screenshotFingerprint');

module.exports = {
    User,
    ReferralEarning,
    Settings,
    Ticket,
    Task,
    ProofSubmission,
    AdminActivity,
    AdWatch,
    DailyTaskProgress,
    ActiveAd,
    YoutubeTask,
    TelegramVerification,
    ReminderConfig,
    UserReminder,
    LevelConfig,
    FeatureUsageLog,
    PendingReaction,
    CompletedTask,
    ShopProduct,
    CourseLesson,
    UserPurchase,
    ImageStylePreset,
    ImageGenLog,
    ImageGenConfig,
    BannerSlide,
    MarketplaceTask,
    MarketplaceSubmission,
    ScreenshotFingerprint,
};
