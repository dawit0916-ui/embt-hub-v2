const express = require('express');
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const validateAdmin = require('../middleware/validateAdmin');
const bot = require('../bot/bot');
const { ShopProduct, CourseLesson, UserPurchase, User } = require('../models');
const { logAdminAction } = require('../utils/logAdminAction');

// =====================================================
// USER PURCHASE ROUTES
// =====================================================

// Get all shop products
router.get('/api/shop/products', async (req, res) => {
    try {
        const { type, category } = req.query;
        let query = { active: true };

        if (type) query.type = type;
        if (category) query.category = category;

        const products = await ShopProduct.find(query)
            .select('_id title category description price thumbnail rating reviews type')
            .sort({ createdAt: -1 });

        res.json({ success: true, products });
    } catch (err) {
        console.error('Get products error:', err);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});


// Get single product details with lessons
router.get('/api/shop/product/:productId', async (req, res) => {
    try {
        const { productId } = req.params;

        const product = await ShopProduct.findById(productId).select('-telegram_file_id');
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        let lessons = [];
        if (product.type === 'course') {
            lessons = await CourseLesson.find({ courseId: productId })
                .select('_id moduleName lessonName duration order')
                .sort({ order: 1 });
        }

        res.json({ success: true, product, lessons });
    } catch (err) {
        console.error('Get product details error:', err);
        res.status(500).json({ error: 'Failed to fetch product' });
    }
});


// Get user's purchases
router.get('/api/secure/my-shop-purchases', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;

        const purchases = await UserPurchase.find({
            userId,
            status: 'active'
        }).populate('productId', '_id title category type thumbnail price');

        res.json({ success: true, purchases });
    } catch (err) {
        console.error('Get purchases error:', err);
        res.status(500).json({ error: 'Failed to fetch purchases' });
    }
});


// Purchase a course/product
router.post('/api/secure/purchase-course', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { productId } = req.body;

        if (!productId) {
            return res.status(400).json({ error: 'productId required' });
        }

        // 1. Get product
        const product = await ShopProduct.findById(productId);
        if (!product || !product.active) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // 2. Get user
        const user = await User.findOne({ user_id: userId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.is_banned) {
            return res.status(403).json({ error: 'Account banned' });
        }

        // 3. Check if already purchased
        const alreadyPurchased = await UserPurchase.findOne({
            userId,
            productId,
            status: 'active'
        });
        if (alreadyPurchased) {
            return res.status(400).json({ error: 'You already own this product' });
        }

        // 4. Check balance
        if (user.balance < product.price) {
            return res.status(400).json({
                error: `Insufficient DASH. You need ${product.price} but have ${user.balance}`
            });
        }

        // 5. Deduct price + create purchase record
        const updatedUser = await User.findOneAndUpdate(
            { user_id: userId },
            {
                $inc: { balance: -product.price },
                $push: {
                    history: {
                        title: `Course Purchase: ${product.title}`,
                        reward: -product.price,
                        taskId: `shop_${productId}`,
                        date: new Date()
                    }
                }
            },
            { new: true }
        );

        await UserPurchase.create({
            userId,
            productId,
            type: product.type,
            price: product.price
        });

        // 6. Log activity
        await logAdminAction({ id: userId, first_name: user.first_name }, 'purchase_course', `Purchased ${product.title} for ${product.price} DASH`);

        res.json({
            success: true,
            message: `Successfully purchased ${product.title}!`,
            newBalance: updatedUser.balance
        });

    } catch (err) {
        console.error('Purchase error:', err);
        res.status(500).json({ error: 'Purchase failed' });
    }
});

// Download purchased APK
router.get('/api/download-apk', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { productId } = req.query;

        if (!productId) {
            return res.status(400).json({ error: 'productId required' });
        }

        const purchase = await UserPurchase.findOne({ userId, productId, status: 'active' });
        if (!purchase) {
            return res.status(403).json({ error: 'You do not own this product' });
        }

        const product = await ShopProduct.findById(productId);
        if (!product || product.type !== 'apk' || !product.telegram_file_id) {
            return res.status(404).json({ error: 'APK not available' });
        }

        let filePath;
        try {
            const fileInfo = await bot.telegram.getFile(product.telegram_file_id);
            filePath = fileInfo.file_path;
        } catch (err) {
            console.error('[APK getFile Error]:', err);
            return res.status(500).json({ error: 'Unable to retrieve APK' });
        }

        const telegramDownloadUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;

        const axios = require('axios');
        try {
            const response = await axios.get(telegramDownloadUrl, {
                responseType: 'stream',
                timeout: 30000
            });

            res.setHeader('Content-Type', 'application/vnd.android.package-archive');
            res.setHeader('Content-Disposition', `attachment; filename="${product.fileName || 'app.apk'}"`);
            if (response.headers['content-length']) {
                res.setHeader('Content-Length', response.headers['content-length']);
            }

            response.data.pipe(res);

            response.data.on('error', (err) => {
                console.error('[APK Stream Error]:', err.message);
                if (!res.headersSent) res.status(500).json({ error: 'Stream interrupted' });
            });

        } catch (err) {
            console.error('[APK Download Error]:', err.message);
            if (!res.headersSent) return res.status(500).json({ error: 'Failed to download APK' });
        }

    } catch (err) {
        console.error('[APK Route Error]:', err);
        if (!res.headersSent) return res.status(500).json({ error: 'Server error' });
    }
});

// =====================================================
// ADMIN SHOP ROUTES
// =====================================================

// Create course
router.post('/api/admin/shop/create-course', validateAdmin, async (req, res) => {
    try {
        const { title, category, description, price, thumbnail } = req.body;

        if (!title || !price) {
            return res.status(400).json({ error: 'title and price required' });
        }

        const product = await ShopProduct.create({
            type: 'course',
            title,
            category: category || 'General',
            description: description || '',
            price: Number(price),
            thumbnail: thumbnail || '',
            createdBy: req.adminUser.id
        });

        await logAdminAction(req.adminUser, 'shop_create_course', `Created course: ${title}`);

        res.json({
            success: true,
            message: 'Course created successfully',
            courseId: product._id
        });

    } catch (err) {
        console.error('Create course error:', err);
        res.status(500).json({ error: 'Failed to create course' });
    }
});


// Add lesson to course (with Telegram file_id)
router.post('/api/admin/shop/lesson/add', validateAdmin, async (req, res) => {
    try {
        const { courseId, moduleName, lessonName, telegram_file_id, duration, order } = req.body;

        if (!courseId || !moduleName || !lessonName || !telegram_file_id) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Verify course exists
        const course = await ShopProduct.findById(courseId);
        if (!course || course.type !== 'course') {
            return res.status(404).json({ error: 'Course not found' });
        }

        const lesson = await CourseLesson.create({
            courseId,
            moduleName,
            lessonName,
            telegram_file_id,
            duration: duration || '0:00',
            order: order || 0
        });

        await logAdminAction(req.adminUser, 'shop_add_lesson', `Added lesson to course ${course.title}`);

        res.json({
            success: true,
            message: 'Lesson added successfully',
            lessonId: lesson._id
        });

    } catch (err) {
        console.error('Add lesson error:', err);
        res.status(500).json({ error: 'Failed to add lesson' });
    }
});


// Get all shop products (admin view)
router.get('/api/admin/shop/products', validateAdmin, async (req, res) => {
    try {
        const products = await ShopProduct.find()
            .select('_id type title category price active createdAt createdBy')
            .sort({ createdAt: -1 });

        res.json({ success: true, products });
    } catch (err) {
        console.error('Get admin products error:', err);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});


// Get course with all lessons (admin view)
router.get('/api/admin/shop/course/:courseId', validateAdmin, async (req, res) => {
    try {
        const { courseId } = req.params;

        const course = await ShopProduct.findById(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const lessons = await CourseLesson.find({ courseId })
            .sort({ order: 1 });

        res.json({ success: true, course, lessons });
    } catch (err) {
        console.error('Get course error:', err);
        res.status(500).json({ error: 'Failed to fetch course' });
    }
});


// Update product
router.put('/api/admin/shop/product/:productId', validateAdmin, async (req, res) => {
    try {
        const { productId } = req.params;
        const updates = req.body;

        const product = await ShopProduct.findByIdAndUpdate(
            productId,
            { ...updates, updatedAt: new Date() },
            { new: true }
        );

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        await logAdminAction(req.adminUser, 'shop_update_product', `Updated product: ${product.title}`);

        res.json({ success: true, product });
    } catch (err) {
        console.error('Update product error:', err);
        res.status(500).json({ error: 'Failed to update product' });
    }
});


// Delete lesson
router.delete('/api/admin/shop/lesson/:lessonId', validateAdmin, async (req, res) => {
    try {
        const { lessonId } = req.params;

        const lesson = await CourseLesson.findByIdAndDelete(lessonId);
        if (!lesson) {
            return res.status(404).json({ error: 'Lesson not found' });
        }

        await logAdminAction(req.adminUser, 'shop_delete_lesson', `Deleted lesson: ${lesson.lessonName}`);

        res.json({ success: true, message: 'Lesson deleted' });
    } catch (err) {
        console.error('Delete lesson error:', err);
        res.status(500).json({ error: 'Failed to delete lesson' });
    }
});


// Delete product (cascade delete lessons)
router.delete('/api/admin/shop/product/:productId', validateAdmin, async (req, res) => {
    try {
        const { productId } = req.params;

        const product = await ShopProduct.findByIdAndDelete(productId);
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Delete all associated lessons
        await CourseLesson.deleteMany({ courseId: productId });

        await logAdminAction(req.adminUser, 'shop_delete_product', `Deleted product: ${product.title}`);

        res.json({ success: true, message: 'Product deleted' });
    } catch (err) {
        console.error('Delete product error:', err);
        res.status(500).json({ error: 'Failed to delete product' });
    }
});


// Get shop statistics
router.get('/api/admin/shop/stats', validateAdmin, async (req, res) => {
    try {
        const totalProducts = await ShopProduct.countDocuments();
        const totalCourses = await ShopProduct.countDocuments({ type: 'course' });
        const totalPurchases = await UserPurchase.countDocuments({ status: 'active' });
        const totalRevenue = await UserPurchase.aggregate([
            { $match: { status: 'active' } },
            { $group: { _id: null, total: { $sum: '$price' } } }
        ]);

        res.json({
            success: true,
            stats: {
                totalProducts,
                totalCourses,
                totalPurchases,
                totalRevenue: totalRevenue[0]?.total || 0
            }
        });
    } catch (err) {
        console.error('Get stats error:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

module.exports = router;
