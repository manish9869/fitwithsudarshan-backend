// src/controllers/uploadController.js
// Admin image uploads → Supabase Storage (public bucket), returns a CDN URL
// that gets stored directly in the content tables (transformations.photo_before,
// blog_posts.image, testimonials.avatar, etc). Replaces the old pattern of
// committing images to /public and referencing them by local path.
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';
import logger from '../config/logger.js';

const BUCKET = 'media';
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

let bucketReady = false;

async function ensureBucket(supabase) {
    if (bucketReady) return;

    const { data } = await supabase.storage.getBucket(BUCKET);
    if (!data) {
        const { error } = await supabase.storage.createBucket(BUCKET, {
            public: true,
            fileSizeLimit: '5MB',
        });
        // Ignore "already exists" races from concurrent first requests.
        if (error && !/already exists/i.test(error.message || '')) throw error;
    }

    bucketReady = true;
}

export async function uploadImage(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }

        if (!ALLOWED_MIME.includes(req.file.mimetype)) {
            return res.status(400).json({ error: 'Only JPEG, PNG, WEBP, GIF, or AVIF images are allowed.' });
        }

        const supabase = getSupabaseAdmin();
        await ensureBucket(supabase);

        const folder = String(req.query.folder || 'uploads').replace(/[^a-z0-9_-]/gi, '') || 'uploads';
        const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/gi, '') || 'jpg';
        const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

        const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(path, req.file.buffer, {
                contentType: req.file.mimetype,
                cacheControl: '31536000',
                upsert: false,
            });

        if (uploadError) throw uploadError;

        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

        logger.info(`[upload] ${req.admin?.username || 'admin'} uploaded ${path}`);

        return res.json({ url: pub.publicUrl, path });
    } catch (err) {
        logger.error(`[upload] failed: ${err.message}`);
        return res.status(500).json({ error: err.message || 'Upload failed.' });
    }
}
