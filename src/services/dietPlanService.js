// src/services/dietPlanService.js
// Diet Plan Generator — saved client plans. Distinct from diet_foods/
// diet_exercises (the reference library, which rides the generic CMS in
// contentService.js): plans have real shape (client info + per-day meals/
// exercises) and their own table, mirroring how coupons work.
import { getSupabaseAdmin } from '../utils/supabaseAdmin.js';

const PLAN_FIELDS = [
    'enrollment_id', 'client_name', 'client_age', 'client_gender', 'client_height',
    'client_weight', 'target_weight', 'goal', 'diet_preference', 'activity_level',
    'allergies', 'client_notes', 'trainer_name', 'trainer_qualification', 'trainer_contact',
    'plan_duration', 'include_exercise', 'status',
];

function pickPlanFields(payload) {
    const row = {};
    for (const key of PLAN_FIELDS) {
        if (payload[key] !== undefined) row[key] = payload[key];
    }
    return row;
}

export async function listDietPlans() {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from('diet_plans')
        .select('id, client_name, goal, diet_preference, plan_duration, status, created_at, updated_at')
        .order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function getDietPlanWithDays(id) {
    const supabase = getSupabaseAdmin();
    const { data: plan, error: planError } = await supabase
        .from('diet_plans')
        .select('*')
        .eq('id', id)
        .maybeSingle();
    if (planError) throw planError;
    if (!plan) return null;

    const { data: days, error: daysError } = await supabase
        .from('diet_plan_days')
        .select('*')
        .eq('plan_id', id)
        .order('day_number', { ascending: true });
    if (daysError) throw daysError;

    return { ...plan, days: days || [] };
}

export async function createDietPlan(payload) {
    const supabase = getSupabaseAdmin();
    const row = pickPlanFields(payload);
    const { data, error } = await supabase.from('diet_plans').insert([row]).select().single();
    if (error) throw error;
    return data;
}

export async function updateDietPlan(id, payload) {
    const supabase = getSupabaseAdmin();
    const row = { ...pickPlanFields(payload), updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from('diet_plans').update(row).eq('id', id).select().single();
    if (error) throw error;
    return data;
}

export async function deleteDietPlan(id) {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('diet_plans').delete().eq('id', id);
    if (error) throw error;
}

// Full delete-then-insert, same pattern as the reference app and this repo's
// own generic content rows — the day list is always saved as a whole, never
// patched piecemeal, so there's no partial-update race to worry about.
export async function replaceDietPlanDays(planId, days) {
    const supabase = getSupabaseAdmin();

    const { error: deleteError } = await supabase.from('diet_plan_days').delete().eq('plan_id', planId);
    if (deleteError) throw deleteError;

    if (!days.length) return [];

    const rows = days.map((d) => ({
        plan_id: planId,
        day_number: d.dayNumber,
        meals: d.meals || [],
        exercises: d.exercises || [],
        rest_day: !!d.restDay,
        notes: d.notes || '',
    }));

    const { data, error: insertError } = await supabase.from('diet_plan_days').insert(rows).select();
    if (insertError) throw insertError;
    return data;
}
