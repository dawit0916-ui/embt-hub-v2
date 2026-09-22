const express = require('express');
const axios = require('axios');
const multer = require('multer'); // new dependency — npm install multer
const router = express.Router();

const validateInitData = require('../middleware/validateInitData');
const validateAdmin = require('../middleware/validateAdmin');
const bot = require('../bot/bot');
const { ShopProduct, CourseLesson, UserPurchase, User } = require('../models');
const { logAdminAction } = require('../utils/logAdminAction');
const { admins, STORAGE_CHANNEL_ID } = require('../config/constants');
const upload = multer({ storage: multer.memoryStorage() });
const { ImageStylePreset, ImageGenLog, ImageGenConfig } = require('../models');
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

        const finalPrice = product.price;

        // 5. Check balance (against the discounted price)
        if (user.balance < finalPrice) {
            return res.status(400).json({
                error: `Insufficient DASH. You need ${finalPrice} but have ${user.balance}`
            });
        }

        // 6. Deduct price + create purchase record
        const updatedUser = await User.findOneAndUpdate(
            { user_id: userId },
            {
                $inc: { balance: -finalPrice },
                $push: {
                    $push: {
                        history: {
                            title: `Course Purchase: ${product.title}`,
                        reward: -finalPrice,
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
            price: finalPrice
        });

        // 6. Log activity
        await logAdminAction({ id: userId, first_name: user.first_name }, 'purchase_course', `Purchased ${product.title} for ${finalPrice} DASH`);

        res.json({
            success: true,
            message: `Successfully purchased ${product.title}!`,
            pricePaid: finalPrice,
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
        const { title, category, description, price, thumbnail, type, telegram_file_id } = req.body;

        if (!title || !price) {
            return res.status(400).json({ error: 'title and price required' });
        }

        const productType = type === 'apk' ? 'apk' : 'course';

        if (productType === 'apk' && !telegram_file_id) {
            return res.status(400).json({ error: 'telegram_file_id required for APK products' });
        }

        const product = await ShopProduct.create({
            type: productType,
            title,
            category: category || 'General',
            description: description || '',
            price: Number(price),
            thumbnail: thumbnail || '',
            telegram_file_id: productType === 'apk' ? telegram_file_id : undefined,
            createdBy: req.adminUser.id
        });

        await logAdminAction(req.adminUser, productType === 'apk' ? 'shop_create_apk' : 'shop_create_course', `Created ${productType}: ${title}`);

        res.json({
            success: true,
            message: productType === 'apk' ? 'APK created successfully' : 'Course created successfully',
            productId: product._id,
            courseId: product._id // kept for backward compatibility
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

// =====================================================
// AI IMAGE GENERATOR ROUTES
// =====================================================

router.get('/api/secure/shop/imagegen/config', validateInitData, async (req, res) => {
    try {
        const userId = req.tgUser.id;

        const styles = await ImageStylePreset.find({ active: true })
            .select('styleId name previewThumbnail')
            .sort({ order: 1 });

        let config = await ImageGenConfig.findOne();
        if (!config) config = await ImageGenConfig.create({});

        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);
        const usesToday = await ImageGenLog.countDocuments({
            userId, status: 'success', createdAt: { $gte: startOfDay }
        });

        res.json({
            success: true,
            styles,
            cost: config.cost,
            dailyCap: config.dailyCap,
            usesToday
        });
    } catch (err) {
        console.error('Get imagegen config error:', err);
        res.status(500).json({ error: 'Failed to load AI image generator' });
    }
});

router.post('/api/secure/shop/imagegen/generate', validateInitData, upload.single('referenceImage'), async (req, res) => {
    try {
        const userId = req.tgUser.id;
        const { styleId } = req.body;

        if (!styleId || !req.file) {
            return res.status(400).json({ error: 'styleId and referenceImage required' });
        }

        const style = await ImageStylePreset.findOne({ styleId, active: true });
        if (!style) {
            return res.status(404).json({ error: 'Style not found' });
        }

        const user = await User.findOne({ user_id: userId });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.is_banned) return res.status(403).json({ error: 'Account banned' });

        let config = await ImageGenConfig.findOne();
        if (!config) config = await ImageGenConfig.create({});

        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);
        const usesToday = await ImageGenLog.countDocuments({
            userId, status: 'success', createdAt: { $gte: startOfDay }
        });
        if (usesToday >= config.dailyCap) {
            return res.status(429).json({ error: 'Daily generation limit reached' });
        }
        if (user.balance < config.cost) {
            return res.status(400).json({ error: `Insufficient DASH. You need ${config.cost} but have ${user.balance}` });
        }

        // Deduct up front, refund on failure
        const updatedUser = await User.findOneAndUpdate(
            { user_id: userId },
            { $inc: { balance: -config.cost } },
            { new: true }
        );        
        try {
            console.log("👁️ Step 1: Running free image-to-text facial structure analysis with LLaVA...");

            const accountId = process.env.CLOUDFLARE_ACCOUNT_ID.trim();
            const bearerToken = process.env.CLOUDFLARE_API_TOKEN.trim();

            // 1. FIXED ENDPOINT ROUTING: Added 'api.' prefix and the full accounts sub-directories path
            const visionModelId = "@cf/llava-hf/llava-1.5-7b-hf";
            const visionUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${visionModelId}`;

            // 2. SCHEMA COMPLIANCE: Convert raw buffer into an 8-bit unsigned integer array (values 0-255)
            const imageByteArray = Array.from(new Uint8Array(req.file.buffer));

            console.log("📡 Shipping compliant binary array payload to LLaVA AI...");

            // 3. Fire the request matching the provided schema definition exactly
            const visionResponse = await axios.post(
                visionUrl,
                {
                    image: imageByteArray,
                    prompt: "In one detailed sentence, describe this person's approximate age, gender, hair color and style, skin tone, eye color, face shape, any distinguishing facial features, body build, and clothing — in that exact order, as plain descriptive text with no commentary.",
                    max_tokens: 512
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': "Bearer " + bearerToken
                    },
                    timeout: 40000
                }
            );

            // Extract text outputs smoothly from Cloudflare's structural schema response
            const imageDescription = visionResponse.data?.result?.description || visionResponse.data?.result?.answer || visionResponse.data?.result?.response || visionResponse.data?.result?.text;

            if (!imageDescription) {
                console.error('[Cloudflare LLaVA Extraction Failure]:', JSON.stringify(visionResponse.data));
                throw new Error("Free LLaVA vision architecture failed to compile an image descriptor text layout.");
            }

            console.log("📝 Step 2: Face and pose analysis compiled successfully! Blending with sketch style rules...");

            // Combine your art styling rules (sketchbook lines, shading) with LLaVA's layout description traits
            const combinedArtPrompt = "A photorealistic portrait of " + imageDescription + ". Reimagined in the following style: " + style.promptTemplate;

            console.log("🎨 Step 3: Pushing final prompt to free native Stable Diffusion pipeline...");

            // 4. FIXED ENDPOINT ROUTING: Applied same full REST structure patterns here to avoid 404 domain drops
            const generationModelId = "@cf/stabilityai/stable-diffusion-xl-base-1.0";
            const generationUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${generationModelId}`;

            const generationResponse = await axios.post(
                generationUrl,
                {
                    prompt: combinedArtPrompt,
                    num_steps: 20
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': "Bearer " + bearerToken
                    },
                    responseType: 'arraybuffer', // Stable Diffusion returns raw new sketch binary chunks instantly
                    timeout: 45000
                }
            );

            // 5. Convert raw response binary data block back into standard Base64 response outputs
            const finalImageBase64 = Buffer.from(generationResponse.data, 'binary').toString('base64');

            const resultPart = {
                inline_data: {
                    mime_type: 'image/png',
                    data: finalImageBase64
                }
            };

            console.log("🎯 Success! Combined pipeline successfully matched features and compiled the sketch for free!");

            const resultBase64 = `data:${resultPart.inline_data.mime_type};base64,${resultPart.inline_data.data}`;

            await ImageGenLog.create({ userId, styleId, cost: config.cost, status: 'success' });

            // Fire-and-forget archive to your Telegram Storage Channel using the clean image buffer
            bot.telegram.sendPhoto(STORAGE_CHANNEL_ID, {
                source: Buffer.from(resultPart.inline_data.data, 'base64')
            }).catch(err => console.error('[Imagegen Archive Error]:', err.message));

            res.json({
                success: true,
                imageBase64: resultBase64,
                cost: config.cost,
                newBalance: updatedUser.balance,
                usesRemaining: config.dailyCap - (usesToday + 1)
            });

        } catch (genErr) {
            let errString = genErr.message;
            if (genErr.response?.data) {
                try {
                    errString = Buffer.from(genErr.response.data).toString();
                } catch (e) {
                    errString = JSON.stringify(genErr.response.data);
                }
            }
            
            console.error('[Imagegen Combined Free Loop Error detail]:', errString);
            
            await User.findOneAndUpdate({ user_id: userId }, { $inc: { balance: config.cost } });
            await ImageGenLog.create({ userId, styleId, cost: config.cost, status: 'refunded' });
            res.status(500).json({ error: 'Generation failed — DASH refunded' });
        }
          
    } catch (err) {
        console.error('Imagegen generate route error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Admin: style presets =====

router.get('/api/admin/shop/imagegen/styles', validateAdmin, async (req, res) => {
    try {
        const styles = await ImageStylePreset.find().sort({ order: 1 });
        res.json({ success: true, styles });
    } catch (err) {
        console.error('Get admin imagegen styles error:', err);
        res.status(500).json({ error: 'Failed to fetch styles' });
    }
});

router.post('/api/admin/shop/imagegen/style/create', validateAdmin, async (req, res) => {
    try {
        const { styleId, name, promptTemplate, previewThumbnail, order } = req.body;
        if (!styleId || !name || !promptTemplate) {
            return res.status(400).json({ error: 'styleId, name, and promptTemplate required' });
        }

        const style = await ImageStylePreset.create({
            styleId, name, promptTemplate, previewThumbnail: previewThumbnail || '', order: order || 0
        });

        await logAdminAction(req.adminUser, 'imagegen_create_style', `Created style: ${name}`);
        res.json({ success: true, message: 'Style created', styleId: style.styleId });
    } catch (err) {
        console.error('Create imagegen style error:', err);
        res.status(500).json({ error: 'Failed to create style' });
    }
});

router.put('/api/admin/shop/imagegen/style/:styleId', validateAdmin, async (req, res) => {
    try {
        const style = await ImageStylePreset.findOneAndUpdate(
            { styleId: req.params.styleId }, req.body, { new: true }
        );
        if (!style) return res.status(404).json({ error: 'Style not found' });

        await logAdminAction(req.adminUser, 'imagegen_update_style', `Updated style: ${style.name}`);
        res.json({ success: true, style });
    } catch (err) {
        console.error('Update imagegen style error:', err);
        res.status(500).json({ error: 'Failed to update style' });
    }
});

router.delete('/api/admin/shop/imagegen/style/:styleId', validateAdmin, async (req, res) => {
    try {
        const style = await ImageStylePreset.findOneAndDelete({ styleId: req.params.styleId });
        if (!style) return res.status(404).json({ error: 'Style not found' });

        await logAdminAction(req.adminUser, 'imagegen_delete_style', `Deleted style: ${style.name}`);
        res.json({ success: true, message: 'Style deleted' });
    } catch (err) {
        console.error('Delete imagegen style error:', err);
        res.status(500).json({ error: 'Failed to delete style' });
    }
});

// ===== Admin: pricing/cap config =====

router.get('/api/admin/shop/imagegen/config', validateAdmin, async (req, res) => {
    try {
        let config = await ImageGenConfig.findOne();
        if (!config) config = await ImageGenConfig.create({});
        res.json({ success: true, config });
    } catch (err) {
        console.error('Get imagegen admin config error:', err);
        res.status(500).json({ error: 'Failed to fetch config' });
    }
});

router.put('/api/admin/shop/imagegen/config', validateAdmin, async (req, res) => {
    try {
        const { cost, dailyCap } = req.body;
        let config = await ImageGenConfig.findOne();
        if (!config) config = new ImageGenConfig();
        if (cost !== undefined) config.cost = Number(cost);
        if (dailyCap !== undefined) config.dailyCap = Number(dailyCap);
        config.updatedAt = new Date();
        await config.save();

        await logAdminAction(req.adminUser, 'imagegen_update_config', `Updated cost=${config.cost}, dailyCap=${config.dailyCap}`);
        res.json({ success: true, config });
    } catch (err) {
        console.error('Update imagegen config error:', err);
        res.status(500).json({ error: 'Failed to update config' });
    }
});

module.exports = router;
