// src/scripts/seedDietTemplates.js
//
// One-time migration of the "Use Template" quick-start step's 5 diet
// templates + 2 workout templates from their old home (hardcoded in
// src/pages/admin/diet/dietTemplates.js) into diet_templates /
// diet_workout_templates, so they're now editable from Admin -> Diet
// Templates instead of requiring a code change + deploy. Safe to re-run —
// upserts on `id`, never duplicates rows.
//
// Usage: node src/scripts/seedDietTemplates.js
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error('❌ SUPABASE_URL / SUPABASE_SECRET_KEY missing from backend .env');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { realtime: { transport: WebSocket } });

async function check(label, promise) {
    const result = await promise;
    if (result.error) {
        console.error(`❌ ${label} failed:`);
        console.error(result.error);
        throw result.error;
    }
    console.log(`✓ ${label} (${result.data?.length ?? 0} rows)`);
    return result.data;
}

// ── Diet templates (days) — exerciseIds dropped: it was dead data even in
// the old JS file, never actually read by generatePlanFromTemplate (the
// exercise rotation always comes from the separately-selected workout
// template below, not from anything embedded per diet-template day).
const fatLossVegTemplate = [
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['idli', 'curd'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['banana'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'dal-fry', 'mix-sabzi', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['makhana', 'green-tea'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'paneer-raw', 'cabbage-sabzi'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['oatmeal'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['apple'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['brown-rice', 'rajma', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['sprouts', 'green-tea'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['khichdi', 'buttermilk'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['poha', 'curd'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['almonds'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'chole', 'mix-sabzi'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['dhokla'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['missi-roti', 'dal-tadka', 'bhindi'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['upma'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['guava'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['brown-rice', 'dal-fry', 'palak-paneer'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['chana-roasted', 'green-tea'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'paneer-raw', 'aloo-gobi'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['dosa', 'chutney'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['orange'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'soya-chunks', 'mix-sabzi', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['walnuts', 'green-tea'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'dal-tadka', 'baigan-bharta'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['idli', 'sambar'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['papaya'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['brown-rice', 'rajma', 'cabbage-sabzi'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['makhana', 'coconut-water'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['missi-roti', 'moong-dal', 'bhindi'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['paratha-plain', 'curd'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['watermelon'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'chole', 'mix-sabzi'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['sprouts', 'tea-with-milk'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['khichdi', 'curd', 'papaya'] },
    ], restDay: true },
];

const fatLossNonVegTemplate = [
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['bread-omelette'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['banana'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['brown-rice', 'chicken-curry', 'mix-sabzi'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['egg-boiled', 'green-tea'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'chicken-breast', 'curd'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['egg-bhurji', 'chapati'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['apple'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['brown-rice', 'fish-curry', 'mix-sabzi'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['almonds', 'green-tea'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'dal-fry', 'chicken-breast'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['egg-boiled', 'egg-boiled', 'chapati'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['orange'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['brown-rice', 'chicken-curry', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['sprouts', 'green-tea'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'fish-fry', 'mix-sabzi'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['poha', 'egg-boiled'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['guava'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['brown-rice', 'chicken-breast', 'dal-fry'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['makhana', 'green-tea'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'fish-curry', 'curd'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['oatmeal', 'egg-boiled'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['banana'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['brown-rice', 'chicken-curry', 'mix-sabzi'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['walnuts', 'green-tea'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'fish-curry', 'bhindi'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['egg-bhurji', 'chapati'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['papaya'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['brown-rice', 'chicken-breast', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['sprouts', 'coconut-water'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'dal-fry', 'fish-curry'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['bread-omelette'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['watermelon'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['white-rice', 'fish-curry', 'mix-sabzi'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['almonds', 'tea-with-milk'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['khichdi', 'curd', 'papaya'] },
    ], restDay: true },
];

const muscleGainVegTemplate = [
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['paratha-aloo', 'milk-full', 'banana'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['almonds', 'whey-protein'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'chapati', 'paneer-butter-masala', 'dal-fry', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['banana', 'peanut-butter'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'chapati', 'rajma', 'paneer-raw', 'milk-full'] },
        { type: 'bedtime', label: 'Bedtime', foodIds: ['milk-full'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['upma', 'milk-full', 'egg-boiled', 'banana'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['whey-protein', 'almonds'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'chapati', 'chole', 'paneer-raw', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['banana', 'milk-full'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'chapati', 'soya-chunks', 'dal-tadka'] },
        { type: 'bedtime', label: 'Bedtime', foodIds: ['milk-full'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['paratha-plain', 'paneer-raw', 'milk-full', 'banana'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['whey-protein', 'walnuts'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'chapati', 'mutter-paneer', 'rajma', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['banana', 'peanut-butter'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['brown-rice', 'dal-fry', 'paneer-raw', 'milk-full'] },
        { type: 'bedtime', label: 'Bedtime', foodIds: ['cheese-slice', 'cheese-slice'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['oatmeal', 'milk-full', 'banana', 'whey-protein'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['almonds', 'mango'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'chapati', 'palak-paneer', 'chole'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['banana', 'milk-full'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'chapati', 'soya-chunks', 'curd'] },
        { type: 'bedtime', label: 'Bedtime', foodIds: ['milk-full'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['masala-dosa', 'milk-full', 'banana'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['whey-protein', 'pomogranate'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'chapati', 'paneer-butter-masala', 'dal-fry', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['protein-bar'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['brown-rice', 'rajma', 'paneer-raw', 'milk-full'] },
        { type: 'bedtime', label: 'Bedtime', foodIds: ['milk-full'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['bread-omelette', 'milk-full', 'banana'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['whey-protein', 'almonds'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['white-rice', 'paneer-raw', 'chole', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['banana', 'milk-full'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'chapati', 'soya-chunks', 'dal-tadka'] },
        { type: 'bedtime', label: 'Bedtime', foodIds: ['milk-full'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['paratha-aloo', 'milk-full', 'mango'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['walnuts', 'grapes'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'chapati', 'mutter-paneer', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['sprouts', 'milk-full'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['khichdi', 'paneer-raw', 'curd', 'milk-full'] },
        { type: 'bedtime', label: 'Bedtime', foodIds: ['milk-full'] },
    ], restDay: true },
];

const muscleGainNonVegTemplate = [
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['egg-boiled', 'egg-boiled', 'egg-boiled', 'egg-boiled', 'chapati', 'banana'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['whey-protein', 'almonds'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'chapati', 'chicken-curry', 'dal-fry', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['egg-boiled', 'egg-boiled', 'banana'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'chapati', 'chicken-breast', 'paneer-raw'] },
        { type: 'bedtime', label: 'Bedtime', foodIds: ['milk-full'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['egg-bhurji', 'paratha-plain', 'milk-full', 'banana'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['whey-protein', 'walnuts'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['brown-rice', 'chicken-breast', 'rajma', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['egg-boiled', 'egg-boiled', 'mango'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'chapati', 'fish-curry', 'dal-fry'] },
        { type: 'bedtime', label: 'Bedtime', foodIds: ['milk-full'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['egg-boiled', 'egg-boiled', 'bread-omelette', 'banana'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['whey-protein', 'almonds'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'chapati', 'chicken-curry', 'chole', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['protein-bar'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['brown-rice', 'fish-fry', 'dal-fry', 'paneer-raw'] },
        { type: 'bedtime', label: 'Bedtime', foodIds: ['milk-full'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['paratha-aloo', 'egg-boiled', 'egg-boiled', 'milk-full'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['whey-protein', 'pomogranate'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['biryani-chicken', 'curd', 'chicken-breast'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['egg-boiled', 'egg-boiled', 'banana'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'chapati', 'fish-curry', 'paneer-raw'] },
        { type: 'bedtime', label: 'Bedtime', foodIds: ['milk-full'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['oatmeal', 'egg-boiled', 'egg-boiled', 'egg-boiled', 'banana'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['whey-protein', 'almonds'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'chapati', 'chicken-breast', 'dal-fry', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['banana', 'milk-full'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['brown-rice', 'fish-curry', 'paneer-raw', 'milk-full'] },
        { type: 'bedtime', label: 'Bedtime', foodIds: ['milk-full'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['bread-omelette', 'bread-omelette', 'milk-full', 'mango'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['whey-protein', 'walnuts'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['white-rice', 'chicken-curry', 'chole', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['egg-boiled', 'egg-boiled', 'banana'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'chapati', 'chicken-breast', 'paneer-raw'] },
        { type: 'bedtime', label: 'Bedtime', foodIds: ['milk-full'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['paratha-plain', 'egg-boiled', 'egg-boiled', 'milk-full', 'banana'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['almonds', 'mango'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['biryani-chicken', 'curd', 'sprouts'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['milk-full', 'banana'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['khichdi', 'chicken-breast', 'curd', 'milk-full'] },
        { type: 'bedtime', label: 'Bedtime', foodIds: ['milk-full'] },
    ], restDay: true },
];

const maintenanceTemplate = [
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['poha', 'curd'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['apple'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'chapati', 'dal-fry', 'mix-sabzi', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['dhokla', 'tea-with-milk'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'paneer-raw', 'bhindi'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['idli', 'curd'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['orange'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['brown-rice', 'rajma', 'mix-sabzi', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['makhana', 'green-tea'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'chole', 'curd'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['upma', 'milk-slim'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['banana'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'chapati', 'palak-paneer', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['sprouts', 'tea-with-milk'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['khichdi', 'curd', 'papaya'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['dosa', 'curd'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['guava'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['chapati', 'chapati', 'mutter-paneer', 'dal-fry', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['chana-roasted', 'coconut-water'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'baigan-bharta', 'curd'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['paratha-plain', 'curd'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['watermelon'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['pulao', 'dal-fry', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['banana', 'tea-with-milk'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'chole', 'mix-sabzi'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['oatmeal'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['papaya'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['brown-rice', 'dal-tadka', 'aloo-gobi', 'curd'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['makhana', 'green-tea'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['missi-roti', 'bhindi', 'curd'] },
    ] },
    { meals: [
        { type: 'breakfast', label: 'Breakfast', foodIds: ['uthappam', 'curd'] },
        { type: 'midMorning', label: 'Mid-Morning Snack', foodIds: ['grapes'] },
        { type: 'lunch', label: 'Lunch', foodIds: ['biryani-veg', 'curd', 'mix-sabzi'] },
        { type: 'evening', label: 'Evening Snack', foodIds: ['sprouts', 'tea-with-milk'] },
        { type: 'dinner', label: 'Dinner', foodIds: ['chapati', 'khichdi', 'curd', 'banana'] },
    ], restDay: true },
];

const TEMPLATES = [
    { id: 'fat-loss-veg', name: 'Fat Loss Indian Veg Plan', description: 'A balanced vegetarian diet for fat loss with moderate protein and controlled carbs', goal: 'Fat Loss', diet_preference: 'Vegetarian', days: fatLossVegTemplate },
    { id: 'fat-loss-nonveg', name: 'Fat Loss Indian Non-Veg Plan', description: 'High protein non-vegetarian diet for effective fat loss', goal: 'Fat Loss', diet_preference: 'Non-Vegetarian', days: fatLossNonVegTemplate },
    { id: 'muscle-gain-veg', name: 'Muscle Gain Indian Veg Plan', description: 'Calorie surplus vegetarian diet for muscle building with high protein', goal: 'Muscle Gain', diet_preference: 'Vegetarian', days: muscleGainVegTemplate },
    { id: 'muscle-gain-nonveg', name: 'Muscle Gain Indian Non-Veg Plan', description: 'High protein non-vegetarian diet with calorie surplus for muscle building', goal: 'Muscle Gain', diet_preference: 'Non-Vegetarian', days: muscleGainNonVegTemplate },
    { id: 'maintenance', name: 'Weight Maintenance Plan', description: 'Balanced diet for maintaining current weight with healthy Indian foods', goal: 'Weight Maintenance', diet_preference: 'Vegetarian', days: maintenanceTemplate },
];

const WORKOUT_TEMPLATES = [
    {
        id: 'home-workout', name: 'Beginner Home Workout Plan', description: 'Simple exercises you can do at home without equipment',
        exercise_days: [
            ['push-ups', 'squats', 'plank', 'jogging'],
            ['lunges', 'diamond-pushups', 'crunches', 'mountain-climbers'],
            ['burpees', 'high-knees', 'bicycle-crunches', 'stretching'],
            ['pike-pushups', 'glute-bridge', 'leg-raises', 'jumping-jacks'],
            ['pull-ups', 'tricep-dips', 'russian-twist', 'brisk-walking'],
            ['surya-namaskar', 'yoga'],
            [],
        ],
    },
    {
        id: 'gym-workout', name: 'Gym Workout Plan', description: 'Complete gym workout with equipment for strength training',
        exercise_days: [
            ['bench-press', 'lat-pulldown', 'shoulder-press', 'plank'],
            ['barbell-squat', 'leg-press', 'leg-curl', 'calf-raises'],
            ['deadlift', 'barbell-row', 'bicep-curl', 'tricep-extension'],
            ['military-press', 'lateral-raises', 'skull-crushers', 'crunches'],
            ['leg-extension', 'bulgarian-lunges', 'preacher-curl', 'hanging-leg-raise'],
            ['dumbbell-press', 'seated-row', 'reverse-fly', 'dead-bug'],
            [],
        ],
    },
];

async function seed() {
    console.log('\n🌱 Seeding diet_templates and diet_workout_templates...\n');

    const templateRows = TEMPLATES.map((t, i) => ({ ...t, sort_order: i, active: true }));
    await check('diet_templates', supabase.from('diet_templates').upsert(templateRows, { onConflict: 'id' }).select());

    const workoutRows = WORKOUT_TEMPLATES.map((t, i) => ({ ...t, sort_order: i, active: true }));
    await check('diet_workout_templates', supabase.from('diet_workout_templates').upsert(workoutRows, { onConflict: 'id' }).select());

    console.log('\n✅ Diet templates seeded successfully.\n');
}

seed().catch((err) => {
    console.error('\n❌ Seed failed:', err.message || err);
    process.exit(1);
});
