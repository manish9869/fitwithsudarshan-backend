/**
 * src/services/leadService.js
 *
 * Handles "Apply For Coaching" hero-modal submissions — a cold enquiry, not
 * yet a full onboarding assessment. Simpler than assessmentService: no file
 * uploads, just a DB insert.
 */

import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';

/**
 * @param {object} fields - { name, email, phone, goal?, experience?, message? }
 * @returns {Promise<object>} the inserted row
 */
export async function submitLead(fields) {
    const supabase = getSupabaseAdmin();

    const row = {
        name: fields.name,
        email: fields.email,
        phone: fields.phone,
        goal: fields.goal || null,
        experience: fields.experience || null,
        message: fields.message || null,
        status: 'new',
        source: 'website',
    };

    const { data, error } = await supabase
        .from('leads')
        .insert([row])
        .select()
        .single();

    if (error) {
        throw new Error(`Failed to save lead: ${error.message}`);
    }

    return data;
}
