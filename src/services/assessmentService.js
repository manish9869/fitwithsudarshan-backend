/**
 * src/services/assessmentService.js
 *
 * Handles RECODE™ onboarding/body assessment submissions:
 *   - Uploads photoFront / photoSide / bloodReport (image OR pdf) to the
 *     private "assessments" Supabase Storage bucket
 *   - Inserts the text fields + storage paths into the `assessments` table
 *   - Generates short-lived signed URLs for the coach notification email
 *
 * Env vars required on the backend:
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SECRET_KEY=sb_secret_...
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import ws from 'ws';
import { toTitleCase } from '../utils/textFormat.js';
const BUCKET = 'assessments';
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 days

let _supabase = null;

function getSupabase() {
    if (_supabase) return _supabase;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;

    if (!url || !key) {
        throw new Error(
            '[assessmentService] Missing SUPABASE_URL or SUPABASE_SECRET_KEY env vars.'
        );
    }

    _supabase = createClient(url, key, {
        auth: { persistSession: false },
        realtime: { transport: ws },
    });
    return _supabase;
}

/**
 * Upload a single file buffer to the assessments bucket.
 * Preserves original extension so PDFs stay as .pdf and images stay as image types.
 * Returns the storage path, or null if no file provided.
 */
async function uploadFile(supabase, file, assessmentId, label) {
    if (!file) return null;

    // Preserve the original file extension (important for PDFs vs images)
    const originalExt = (file.originalname?.split('.').pop() || 'bin').toLowerCase();
    const path = `${assessmentId}/${label}-${randomUUID()}.${originalExt}`;

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
 * Submit a full assessment: uploads files → inserts DB row.
 *
 * @param {object} fields - all non-file text fields from the form
 * @param {object} files  - { photoFront, photoSide, bloodReport }
 * @returns {Promise<{ id: string, row: object }>}
 */
export async function submitAssessment(fields, files = {}) {
    const supabase = getSupabase();
    const assessmentId = randomUUID();

    // Upload files first — if one fails we haven't written a partial DB row yet
    const [photoFrontPath, photoSidePath, bloodReportPath] = await Promise.all([
        uploadFile(supabase, files.photoFront, assessmentId, 'front'),
        uploadFile(supabase, files.photoSide, assessmentId, 'side'),
        uploadFile(supabase, files.bloodReport, assessmentId, 'blood-report'),
    ]);

    const row = {
        id: assessmentId,
        first_name: toTitleCase(fields.firstName),
        last_name: fields.lastName ? toTitleCase(fields.lastName) : null,
        email: fields.email || null,   // ← added: customer email for confirmation
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
 * Generate a temporary signed URL for a stored file.
 * Works for both images AND PDFs — the signed URL is a direct download/view link.
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
 * Sign all three file paths for a submitted assessment.
 */
export async function getSignedFileUrls({ photo_front_path, photo_side_path, blood_report_path }) {
    const [photoFrontUrl, photoSideUrl, bloodReportUrl] = await Promise.all([
        getSignedFileUrl(photo_front_path),
        getSignedFileUrl(photo_side_path),
        getSignedFileUrl(blood_report_path),
    ]);
    return { photoFrontUrl, photoSideUrl, bloodReportUrl };
}