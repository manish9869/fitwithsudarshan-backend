/**
 * src/services/assessmentService.js
 *
 * Handles RECODE™ onboarding/body assessment submissions:
 *   - Uploads photoFront / photoSide / bloodReport to the private
 *     "assessments" Supabase Storage bucket
 *   - Inserts the text fields + storage paths into the `assessments` table
 *   - Generates short-lived signed URLs (for the coach notification email)
 *
 * IMPORTANT: this file runs on the BACKEND (Node/Express) and uses Supabase's
 * SECRET key (the new replacement for the legacy service_role JWT) — never
 * expose this key to the frontend. Add to your backend .env (and Vercel
 * project env vars):
 *
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SECRET_KEY=sb_secret_...
 *
 * SUPABASE_SECRET_KEY bypasses Row Level Security and has full project
 * access — this is the direct equivalent of the old service_role key.
 * It is DIFFERENT from SUPABASE_PUBLISHABLE_KEY (frontend-safe, anon-equivalent)
 * and from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY used in the frontend.
 * SUPABASE_JWKS_URL is not needed here — that's only for verifying end-user
 * JWTs yourself, which this backend route doesn't do.
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const BUCKET = 'assessments';
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 days — plenty for the coach to review

let _supabase = null;

function getSupabase() {
    if (_supabase) return _supabase;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;

    if (!url || !key) {
        throw new Error(
            '[assessmentService] Missing SUPABASE_URL or SUPABASE_SECRET_KEY env vars on the backend.'
        );
    }

    _supabase = createClient(url, key, {
        auth: { persistSession: false },
    });
    return _supabase;
}

/**
 * Upload a single file buffer to the assessments bucket.
 * @returns {Promise<string|null>} storage path, or null if no file provided
 */
async function uploadFile(supabase, file, assessmentId, label) {
    if (!file) return null;

    const ext = (file.originalname?.split('.').pop() || 'jpg').toLowerCase();
    const path = `${assessmentId}/${label}-${randomUUID()}.${ext}`;

    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file.buffer, {
            contentType: file.mimetype || 'application/octet-stream',
            upsert: false,
        });

    if (error) {
        throw new Error(`Failed to upload ${label}: ${error.message}`);
    }

    return path;
}

/**
 * Submit a full assessment: uploads files + inserts the DB row.
 *
 * @param {object} fields - all non-file text fields from the form
 * @param {object} files  - { photoFront, photoSide, bloodReport } — each
 *                           either a multer file object ({ buffer, originalname,
 *                           mimetype }) or undefined/null
 * @returns {Promise<{ id: string, row: object }>}
 */
export async function submitAssessment(fields, files = {}) {
    const supabase = getSupabase();
    const assessmentId = randomUUID();

    // Upload files first — if one fails we haven't written a partial DB row yet.
    const [photoFrontPath, photoSidePath, bloodReportPath] = await Promise.all([
        uploadFile(supabase, files.photoFront, assessmentId, 'front'),
        uploadFile(supabase, files.photoSide, assessmentId, 'side'),
        uploadFile(supabase, files.bloodReport, assessmentId, 'blood-report'),
    ]);

    const row = {
        id: assessmentId,
        first_name: fields.firstName,
        last_name: fields.lastName || null,
        whatsapp: fields.whatsapp,
        age: fields.age,
        gender: fields.gender,
        city: fields.city,
        plan: fields.plan,

        current_weight: fields.currentWeight,
        height: fields.height,
        main_goal: fields.mainGoal,
        desired_result: fields.desiredResult,
        why_now: fields.whyNow,
        profession: fields.profession || null,
        workout_status: fields.workoutStatus,
        training_location: fields.trainingLocation || null,
        training_days: fields.trainingDays,

        food_preference: fields.foodPreference,
        daily_food_routine: fields.dailyFoodRoutine,
        biggest_struggle: fields.biggestStruggle,
        sleep_hours: fields.sleepHours,

        medical_conditions: fields.medicalConditions || null,

        commitment: fields.commitment ? parseInt(fields.commitment, 10) : null,

        photo_front_path: photoFrontPath,
        photo_side_path: photoSidePath,
        blood_report_path: bloodReportPath,

        status: 'new',
    };

    const { data, error } = await supabase
        .from('assessments')
        .insert([row])
        .select()
        .single();

    if (error) {
        throw new Error(`Failed to save assessment: ${error.message}`);
    }

    return { id: assessmentId, row: data };
}

/**
 * Generate a temporary signed URL for a stored file (used in the coach
 * notification email so they can view photos without the bucket being public).
 * @param {string|null} path
 * @returns {Promise<string|null>}
 */
export async function getSignedFileUrl(path) {
    if (!path) return null;

    const supabase = getSupabase();
    const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);

    if (error) {
        console.error(`[assessmentService] Failed to sign URL for ${path}:`, error.message);
        return null;
    }

    return data.signedUrl;
}

/**
 * Convenience: sign all three file paths for a submitted assessment at once.
 */
export async function getSignedFileUrls({ photo_front_path, photo_side_path, blood_report_path }) {
    const [photoFrontUrl, photoSideUrl, bloodReportUrl] = await Promise.all([
        getSignedFileUrl(photo_front_path),
        getSignedFileUrl(photo_side_path),
        getSignedFileUrl(blood_report_path),
    ]);
    return { photoFrontUrl, photoSideUrl, bloodReportUrl };
}