// src/scripts/seedDietData.js
// One-off seed for the Diet Plan Generator's reference library (diet_foods,
// diet_exercises). Run once after creating the tables from schema.sql:
//   node src/scripts/seedDietData.js
// Safe to re-run — upserts on `id`, never duplicates rows.
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

// [id, name, category, calories, protein, carbs, fats, servingSize, isVeg, isEggetarian]
const FOODS = [
    // Breakfast
    ['poha', 'Poha (Flattened Rice)', 'Breakfast', 180, 3, 35, 4, '1 cup', true, true],
    ['upma', 'Upma', 'Breakfast', 200, 5, 38, 4, '1 cup', true, true],
    ['idli', 'Idli (2 pieces)', 'Breakfast', 120, 4, 24, 1, '2 pieces', true, true],
    ['dosa', 'Plain Dosa', 'Breakfast', 150, 4, 28, 3, '1 piece', true, true],
    ['masala-dosa', 'Masala Dosa', 'Breakfast', 250, 5, 40, 7, '1 piece', true, true],
    ['uthappam', 'Uthappam', 'Breakfast', 200, 5, 35, 5, '1 piece', true, true],
    ['paratha-plain', 'Plain Paratha', 'Breakfast', 220, 4, 32, 8, '1 piece', true, true],
    ['paratha-aloo', 'Aloo Paratha', 'Breakfast', 300, 6, 45, 10, '1 piece', true, true],
    ['oatmeal', 'Oatmeal with Milk', 'Breakfast', 200, 8, 32, 5, '1 bowl', true, true],
    ['bread-omelette', 'Bread Omelette', 'Breakfast', 280, 14, 25, 14, '2 slices + 2 eggs', false, true],
    ['sabudana-khichdi', 'Sabudana Khichdi', 'Breakfast', 250, 4, 45, 8, '1 bowl', true, true],
    ['besan-chilla', 'Besan Chilla', 'Breakfast', 180, 9, 18, 8, '2 pieces', true, true],
    ['moong-dal-chilla', 'Moong Dal Chilla', 'Breakfast', 160, 10, 16, 5, '2 pieces', true, true],
    ['rava-idli', 'Rava Idli (2 pieces)', 'Breakfast', 140, 4, 22, 3, '2 pieces', true, true],
    ['vermicelli-upma', 'Vermicelli Upma', 'Breakfast', 190, 5, 35, 4, '1 cup', true, true],
    ['cornflakes-milk', 'Cornflakes with Milk', 'Breakfast', 180, 6, 32, 3, '1 bowl', true, true],
    ['muesli-milk', 'Muesli with Milk', 'Breakfast', 220, 8, 34, 6, '1 bowl', true, true],
    ['stuffed-paratha-paneer', 'Paneer Stuffed Paratha', 'Breakfast', 320, 10, 40, 12, '1 piece', true, true],
    ['sattu-paratha', 'Sattu Paratha', 'Breakfast', 260, 8, 38, 8, '1 piece', true, true],
    ['bread-butter-jam', 'Bread Butter Jam', 'Breakfast', 200, 4, 30, 7, '2 slices', true, true],

    // Grains & Roti
    ['chapati', 'Chapati/Roti', 'Grains & Roti', 80, 3, 16, 1, '1 piece', true, true],
    ['missi-roti', 'Missi Roti', 'Grains & Roti', 100, 4, 18, 2, '1 piece', true, true],
    ['makki-ki-roti', 'Makki ki Roti', 'Grains & Roti', 120, 2, 22, 3, '1 piece', true, true],
    ['thepla', 'Thepla', 'Grains & Roti', 110, 3, 18, 3, '1 piece', true, true],
    ['bajra-roti', 'Bajra Roti', 'Grains & Roti', 100, 3, 20, 2, '1 piece', true, true],
    ['jowar-roti', 'Jowar Roti', 'Grains & Roti', 105, 3, 21, 2, '1 piece', true, true],
    ['tandoori-roti', 'Tandoori Roti', 'Grains & Roti', 120, 4, 22, 2, '1 piece', true, true],
    ['naan', 'Naan', 'Grains & Roti', 260, 8, 48, 5, '1 piece', true, true],
    ['lachha-paratha', 'Lachha Paratha', 'Grains & Roti', 250, 5, 36, 9, '1 piece', true, true],
    ['rumali-roti', 'Rumali Roti', 'Grains & Roti', 90, 3, 17, 1, '1 piece', true, true],

    // Rice & Dal
    ['white-rice', 'White Rice', 'Rice & Dal', 150, 3, 34, 0.5, '1 cup', true, true],
    ['brown-rice', 'Brown Rice', 'Rice & Dal', 180, 4, 36, 1.5, '1 cup', true, true],
    ['dal-fry', 'Dal Fry', 'Rice & Dal', 150, 9, 22, 4, '1 bowl', true, true],
    ['dal-tadka', 'Dal Tadka', 'Rice & Dal', 180, 9, 24, 6, '1 bowl', true, true],
    ['rajma', 'Rajma (Kidney Beans)', 'Rice & Dal', 160, 10, 26, 3, '1 bowl', true, true],
    ['chole', 'Chole (Chickpea Curry)', 'Rice & Dal', 180, 11, 28, 4, '1 bowl', true, true],
    ['khichdi', 'Khichdi', 'Rice & Dal', 200, 6, 38, 3, '1 bowl', true, true],
    ['pulao', 'Vegetable Pulao', 'Rice & Dal', 250, 5, 42, 6, '1 cup', true, true],
    ['biryani-veg', 'Veg Biryani', 'Rice & Dal', 280, 6, 44, 8, '1 cup', true, true],
    ['biryani-chicken', 'Chicken Biryani', 'Rice & Dal', 380, 20, 45, 12, '1 cup', false, false],
    ['jeera-rice', 'Jeera Rice', 'Rice & Dal', 200, 4, 40, 4, '1 cup', true, true],
    ['lemon-rice', 'Lemon Rice', 'Rice & Dal', 210, 4, 38, 6, '1 cup', true, true],
    ['dal-makhani', 'Dal Makhani', 'Rice & Dal', 260, 11, 24, 14, '1 bowl', true, true],
    ['sambar', 'Sambar', 'Rice & Dal', 140, 7, 20, 3, '1 bowl', true, true],
    ['curd-rice', 'Curd Rice', 'Rice & Dal', 220, 6, 34, 6, '1 bowl', true, true],

    // Vegetables
    ['mix-sabzi', 'Mixed Vegetable Sabzi', 'Vegetables', 120, 4, 12, 6, '1 bowl', true, true],
    ['aloo-gobi', 'Aloo Gobi', 'Vegetables', 150, 4, 18, 7, '1 bowl', true, true],
    ['bhindi', 'Bhindi Masala', 'Vegetables', 130, 3, 14, 6, '1 bowl', true, true],
    ['baigan-bharta', 'Baigan Bharta', 'Vegetables', 110, 3, 10, 6, '1 bowl', true, true],
    ['palak-paneer', 'Palak Paneer', 'Vegetables', 280, 14, 12, 18, '1 bowl', true, true],
    ['paneer-butter-masala', 'Paneer Butter Masala', 'Vegetables', 320, 16, 14, 22, '1 bowl', true, true],
    ['mutter-paneer', 'Mutter Paneer', 'Vegetables', 260, 14, 16, 15, '1 bowl', true, true],
    ['cabbage-sabzi', 'Cabbage Sabzi', 'Vegetables', 80, 3, 8, 4, '1 bowl', true, true],
    ['aloo-methi', 'Aloo Methi', 'Vegetables', 140, 4, 16, 6, '1 bowl', true, true],
    ['dum-aloo', 'Dum Aloo', 'Vegetables', 200, 4, 24, 10, '1 bowl', true, true],
    ['veg-kofta', 'Vegetable Kofta Curry', 'Vegetables', 220, 5, 18, 14, '1 bowl', true, true],
    ['bharwa-bhindi', 'Bharwa Bhindi', 'Vegetables', 150, 4, 14, 8, '1 bowl', true, true],
    ['lauki-sabzi', 'Lauki Sabzi', 'Vegetables', 90, 2, 10, 4, '1 bowl', true, true],
    ['karela-sabzi', 'Karela Sabzi', 'Vegetables', 100, 3, 9, 6, '1 bowl', true, true],

    // Dairy & Paneer
    ['curd', 'Curd/Yogurt', 'Dairy & Paneer', 100, 6, 8, 4, '1 bowl', true, true],
    ['paneer-raw', 'Paneer (Fresh)', 'Dairy & Paneer', 180, 14, 2, 14, '100g', true, true],
    ['milk-full', 'Full Cream Milk', 'Dairy & Paneer', 150, 8, 12, 8, '1 glass', true, true],
    ['milk-slim', 'Slim Milk', 'Dairy & Paneer', 80, 8, 12, 0.5, '1 glass', true, true],
    ['buttermilk', 'Buttermilk', 'Dairy & Paneer', 50, 3, 5, 2, '1 glass', true, true],
    ['lassi', 'Lassi (Sweet)', 'Dairy & Paneer', 180, 6, 28, 5, '1 glass', true, true],
    ['cheese-slice', 'Cheese Slice', 'Dairy & Paneer', 60, 4, 1, 5, '1 slice', true, true],
    ['paneer-tikka', 'Paneer Tikka', 'Dairy & Paneer', 250, 18, 8, 16, '1 plate', true, true],

    // Proteins
    ['egg-boiled', 'Boiled Egg', 'Proteins', 70, 6, 0.5, 5, '1 egg', false, true],
    ['egg-bhurji', 'Egg Bhurji', 'Proteins', 180, 14, 3, 12, '2 eggs', false, true],
    ['chicken-breast', 'Grilled Chicken Breast', 'Proteins', 165, 31, 0, 3.6, '100g', false, false],
    ['chicken-curry', 'Chicken Curry', 'Proteins', 280, 28, 8, 16, '1 bowl', false, false],
    ['fish-curry', 'Fish Curry', 'Proteins', 220, 25, 6, 10, '1 bowl', false, false],
    ['fish-fry', 'Fish Fry', 'Proteins', 250, 25, 5, 14, '100g', false, false],
    ['soya-chunks', 'Soya Chunks Curry', 'Proteins', 170, 20, 12, 5, '1 bowl', true, true],
    ['sprouts', 'Mixed Sprouts', 'Proteins', 120, 10, 18, 1, '1 bowl', true, true],
    ['moong-dal', 'Moong Dal (Whole)', 'Proteins', 140, 10, 20, 2, '1 bowl', true, true],
    ['tofu', 'Tofu', 'Proteins', 145, 16, 4, 9, '100g', true, true],
    ['egg-white', 'Egg White', 'Proteins', 17, 4, 0, 0, '1 egg white', false, true],
    ['chicken-tikka', 'Chicken Tikka', 'Proteins', 200, 26, 4, 9, '100g', false, false],
    ['mutton-curry', 'Mutton Curry', 'Proteins', 320, 24, 6, 22, '1 bowl', false, false],
    ['prawns-curry', 'Prawns Curry', 'Proteins', 200, 22, 6, 9, '1 bowl', false, false],

    // Snacks
    ['almonds', 'Almonds', 'Snacks', 160, 6, 6, 14, '25g', true, true],
    ['walnuts', 'Walnuts', 'Snacks', 180, 4, 4, 18, '25g', true, true],
    ['peanuts', 'Peanuts (Roasted)', 'Snacks', 170, 7, 6, 14, '30g', true, true],
    ['chana-roasted', 'Roasted Chana', 'Snacks', 130, 7, 18, 3, '30g', true, true],
    ['makhana', 'Makhana (Fox Nuts)', 'Snacks', 90, 3, 16, 1, '25g', true, true],
    ['dhokla', 'Dhokla (4 pieces)', 'Snacks', 150, 5, 26, 3, '4 pieces', true, true],
    ['kachori', 'Kachori', 'Snacks', 250, 5, 30, 12, '1 piece', true, true],
    ['samosa', 'Samosa', 'Snacks', 260, 4, 28, 14, '1 piece', true, true],
    ['poha-snack', 'Poha Chivda', 'Snacks', 120, 2, 20, 3, '30g', true, true],
    ['cashews', 'Cashews', 'Snacks', 165, 5, 9, 13, '25g', true, true],
    ['peanut-butter', 'Peanut Butter', 'Snacks', 190, 8, 6, 16, '2 tbsp', true, true],
    ['bhel-puri', 'Bhel Puri', 'Snacks', 180, 4, 32, 5, '1 plate', true, true],
    ['sprouts-chaat', 'Sprouts Chaat', 'Snacks', 140, 9, 20, 3, '1 bowl', true, true],
    ['chutney', 'Coconut Chutney', 'Snacks', 60, 1, 4, 5, '2 tbsp', true, true],

    // Fruits
    ['banana', 'Banana', 'Fruits', 90, 1, 23, 0.3, '1 medium', true, true],
    ['apple', 'Apple', 'Fruits', 72, 0.5, 19, 0.3, '1 medium', true, true],
    ['orange', 'Orange', 'Fruits', 60, 1, 15, 0.2, '1 medium', true, true],
    ['papaya', 'Papaya', 'Fruits', 55, 0.6, 14, 0.2, '1 cup', true, true],
    ['watermelon', 'Watermelon', 'Fruits', 45, 1, 11, 0.2, '1 cup', true, true],
    ['guava', 'Guava', 'Fruits', 68, 2.5, 14, 1, '1 medium', true, true],
    ['mango', 'Mango', 'Fruits', 100, 1, 25, 0.6, '1 medium', true, true],
    ['pomogranate', 'Pomegranate', 'Fruits', 80, 1.5, 18, 1, '1/2 cup', true, true],
    ['grapes', 'Grapes', 'Fruits', 60, 0.5, 16, 0.3, '1 cup', true, true],
    ['pineapple', 'Pineapple', 'Fruits', 50, 0.5, 13, 0.2, '1 cup', true, true],
    ['kiwi', 'Kiwi', 'Fruits', 42, 0.8, 10, 0.4, '1 medium', true, true],
    ['pear', 'Pear', 'Fruits', 57, 0.4, 15, 0.1, '1 medium', true, true],

    // Beverages
    ['green-tea', 'Green Tea', 'Beverages', 2, 0, 0.5, 0, '1 cup', true, true],
    ['black-coffee', 'Black Coffee', 'Beverages', 5, 0.5, 1, 0, '1 cup', true, true],
    ['tea-with-milk', 'Tea with Milk', 'Beverages', 60, 2, 8, 2, '1 cup', true, true],
    ['coconut-water', 'Coconut Water', 'Beverages', 45, 1, 10, 0.5, '1 glass', true, true],
    ['fresh-juice', 'Fresh Fruit Juice', 'Beverages', 90, 1, 22, 0.3, '1 glass', true, true],
    ['lemon-water', 'Lemon Water', 'Beverages', 10, 0, 2, 0, '1 glass', true, true],
    ['buttermilk-spiced', 'Spiced Buttermilk', 'Beverages', 45, 3, 4, 2, '1 glass', true, true],

    // Supplements
    ['whey-protein', 'Whey Protein Scoop', 'Supplements', 120, 24, 3, 2, '1 scoop', true, true],
    ['protein-bar', 'Protein Bar', 'Supplements', 200, 20, 22, 8, '1 bar', true, true],
    ['mass-gainer', 'Mass Gainer Shake', 'Supplements', 350, 25, 50, 5, '1 scoop', true, true],
    ['bcaa-scoop', 'BCAA Scoop', 'Supplements', 10, 2, 0, 0, '1 scoop', true, true],
];

// [id, name, muscleGroup, caloriesBurned, sets, reps, duration, difficulty, location]
const EXERCISES = [
    // Cardio
    ['walking', 'Walking', 'Cardio', 150, 0, '-', '30 min', 'Beginner', 'Home'],
    ['brisk-walking', 'Brisk Walking', 'Cardio', 200, 0, '-', '30 min', 'Beginner', 'Home'],
    ['running', 'Running', 'Cardio', 300, 0, '-', '30 min', 'Intermediate', 'Home'],
    ['jogging', 'Jogging', 'Cardio', 250, 0, '-', '30 min', 'Beginner', 'Home'],
    ['cycling', 'Cycling', 'Cardio', 250, 0, '-', '30 min', 'Beginner', 'Home'],
    ['jumping-jacks', 'Jumping Jacks', 'Cardio', 100, 3, '20', '5 min', 'Beginner', 'Home'],
    ['jump-rope', 'Jump Rope', 'Cardio', 200, 0, '-', '15 min', 'Intermediate', 'Home'],
    ['burpees', 'Burpees', 'Cardio', 150, 3, '10', '10 min', 'Intermediate', 'Home'],
    ['mountain-climbers', 'Mountain Climbers', 'Cardio', 100, 3, '20 each leg', '5 min', 'Intermediate', 'Home'],
    ['high-knees', 'High Knees', 'Cardio', 120, 3, '30 seconds', '5 min', 'Beginner', 'Home'],
    ['stair-climbing', 'Stair Climbing', 'Cardio', 180, 0, '-', '15 min', 'Beginner', 'Both'],
    ['elliptical', 'Elliptical Trainer', 'Cardio', 220, 0, '-', '20 min', 'Beginner', 'Gym'],
    ['swimming', 'Swimming', 'Cardio', 300, 0, '-', '30 min', 'Intermediate', 'Both'],
    ['rowing-machine', 'Rowing Machine', 'Cardio', 240, 0, '-', '20 min', 'Intermediate', 'Gym'],
    ['spot-jogging', 'Spot Jogging', 'Cardio', 90, 0, '-', '10 min', 'Beginner', 'Home'],

    // Chest
    ['push-ups', 'Push-ups', 'Chest', 50, 3, '15', '5 min', 'Beginner', 'Home'],
    ['inclined-push-ups', 'Inclined Push-ups', 'Chest', 45, 3, '12', '5 min', 'Beginner', 'Home'],
    ['declined-push-ups', 'Declined Push-ups', 'Chest', 55, 3, '10', '5 min', 'Intermediate', 'Home'],
    ['dumbbell-press', 'Dumbbell Press', 'Chest', 80, 4, '12', '8 min', 'Intermediate', 'Gym'],
    ['bench-press', 'Bench Press', 'Chest', 100, 4, '10', '10 min', 'Intermediate', 'Gym'],
    ['chest-fly', 'Cable Chest Fly', 'Chest', 70, 3, '12', '6 min', 'Intermediate', 'Gym'],
    ['dumbbell-fly', 'Dumbbell Fly', 'Chest', 60, 3, '12', '6 min', 'Intermediate', 'Gym'],
    ['cable-crossover', 'Cable Crossover', 'Chest', 65, 3, '12', '6 min', 'Intermediate', 'Gym'],
    ['incline-dumbbell-press', 'Incline Dumbbell Press', 'Chest', 85, 4, '10', '8 min', 'Intermediate', 'Gym'],
    ['pec-deck', 'Pec Deck Machine', 'Chest', 60, 3, '12', '6 min', 'Beginner', 'Gym'],

    // Back
    ['pull-ups', 'Pull-ups', 'Back', 80, 3, '8-10', '8 min', 'Intermediate', 'Both'],
    ['lat-pulldown', 'Lat Pulldown', 'Back', 70, 4, '12', '8 min', 'Beginner', 'Gym'],
    ['seated-row', 'Seated Cable Row', 'Back', 70, 4, '12', '8 min', 'Beginner', 'Gym'],
    ['dumbbell-row', 'Dumbbell Row', 'Back', 60, 3, '12 each side', '6 min', 'Beginner', 'Both'],
    ['barbell-row', 'Barbell Row', 'Back', 90, 4, '10', '8 min', 'Intermediate', 'Gym'],
    ['deadlift', 'Deadlift', 'Back', 120, 4, '8', '10 min', 'Advanced', 'Gym'],
    ['superman', 'Superman Hold', 'Back', 40, 3, '10', '5 min', 'Beginner', 'Home'],
    ['t-bar-row', 'T-Bar Row', 'Back', 85, 4, '10', '8 min', 'Intermediate', 'Gym'],
    ['face-pulls', 'Face Pulls', 'Back', 50, 3, '15', '5 min', 'Intermediate', 'Gym'],
    ['hyperextensions', 'Hyperextensions', 'Back', 55, 3, '12', '5 min', 'Beginner', 'Gym'],

    // Shoulders
    ['shoulder-press', 'Shoulder Press (Dumbbell)', 'Shoulders', 70, 4, '12', '8 min', 'Intermediate', 'Both'],
    ['military-press', 'Military Press', 'Shoulders', 80, 4, '10', '8 min', 'Intermediate', 'Gym'],
    ['lateral-raises', 'Lateral Raises', 'Shoulders', 50, 3, '15', '6 min', 'Beginner', 'Both'],
    ['front-raises', 'Front Raises', 'Shoulders', 50, 3, '12', '5 min', 'Beginner', 'Both'],
    ['reverse-fly', 'Reverse Fly', 'Shoulders', 50, 3, '12', '5 min', 'Intermediate', 'Both'],
    ['pike-pushups', 'Pike Push-ups', 'Shoulders', 50, 3, '10', '5 min', 'Intermediate', 'Home'],
    ['arnold-press', 'Arnold Press', 'Shoulders', 75, 4, '10', '8 min', 'Intermediate', 'Gym'],
    ['upright-row', 'Upright Row', 'Shoulders', 55, 3, '12', '6 min', 'Intermediate', 'Gym'],
    ['shrugs', 'Dumbbell Shrugs', 'Shoulders', 40, 3, '15', '5 min', 'Beginner', 'Both'],

    // Arms
    ['bicep-curl', 'Bicep Curls', 'Arms', 50, 3, '12', '5 min', 'Beginner', 'Both'],
    ['hammer-curl', 'Hammer Curls', 'Arms', 50, 3, '12', '5 min', 'Beginner', 'Both'],
    ['tricep-dips', 'Tricep Dips', 'Arms', 60, 3, '10', '5 min', 'Beginner', 'Home'],
    ['tricep-extension', 'Tricep Extension', 'Arms', 50, 3, '12', '5 min', 'Beginner', 'Both'],
    ['skull-crushers', 'Skull Crushers', 'Arms', 60, 3, '10', '6 min', 'Intermediate', 'Gym'],
    ['preacher-curl', 'Preacher Curl', 'Arms', 55, 3, '12', '6 min', 'Intermediate', 'Gym'],
    ['diamond-pushups', 'Diamond Push-ups', 'Arms', 55, 3, '10', '5 min', 'Intermediate', 'Home'],
    ['concentration-curl', 'Concentration Curl', 'Arms', 45, 3, '12 each arm', '6 min', 'Intermediate', 'Both'],
    ['cable-tricep-pushdown', 'Cable Tricep Pushdown', 'Arms', 50, 3, '12', '5 min', 'Beginner', 'Gym'],
    ['reverse-curl', 'Reverse Curl', 'Arms', 50, 3, '12', '5 min', 'Intermediate', 'Both'],

    // Legs
    ['squats', 'Bodyweight Squats', 'Legs', 60, 3, '15', '5 min', 'Beginner', 'Home'],
    ['goblet-squat', 'Goblet Squat', 'Legs', 80, 4, '12', '8 min', 'Intermediate', 'Gym'],
    ['barbell-squat', 'Barbell Squat', 'Legs', 120, 4, '10', '12 min', 'Advanced', 'Gym'],
    ['leg-press', 'Leg Press', 'Legs', 100, 4, '12', '10 min', 'Intermediate', 'Gym'],
    ['lunges', 'Lunges', 'Legs', 70, 3, '12 each leg', '8 min', 'Beginner', 'Home'],
    ['bulgarian-lunges', 'Bulgarian Split Squat', 'Legs', 80, 3, '10 each leg', '8 min', 'Intermediate', 'Both'],
    ['leg-extension', 'Leg Extension', 'Legs', 60, 3, '12', '6 min', 'Beginner', 'Gym'],
    ['leg-curl', 'Leg Curl', 'Legs', 60, 3, '12', '6 min', 'Beginner', 'Gym'],
    ['calf-raises', 'Calf Raises', 'Legs', 40, 4, '15', '5 min', 'Beginner', 'Both'],
    ['glute-bridge', 'Glute Bridge', 'Legs', 50, 3, '15', '5 min', 'Beginner', 'Home'],
    ['hip-thrust', 'Hip Thrust', 'Legs', 70, 3, '12', '8 min', 'Intermediate', 'Both'],
    ['step-ups', 'Step-ups', 'Legs', 65, 3, '12 each leg', '8 min', 'Beginner', 'Home'],
    ['sumo-squat', 'Sumo Squat', 'Legs', 65, 3, '15', '6 min', 'Beginner', 'Home'],
    ['wall-sit', 'Wall Sit', 'Legs', 40, 3, '30-45 sec', '5 min', 'Beginner', 'Home'],

    // Core
    ['plank', 'Plank Hold', 'Core', 50, 3, '30-60 sec', '5 min', 'Beginner', 'Home'],
    ['crunches', 'Crunches', 'Core', 40, 3, '20', '5 min', 'Beginner', 'Home'],
    ['bicycle-crunches', 'Bicycle Crunches', 'Core', 60, 3, '20 each side', '6 min', 'Beginner', 'Home'],
    ['russian-twist', 'Russian Twist', 'Core', 50, 3, '20', '5 min', 'Beginner', 'Home'],
    ['leg-raises', 'Leg Raises', 'Core', 50, 3, '12', '5 min', 'Intermediate', 'Home'],
    ['dead-bug', 'Dead Bug', 'Core', 40, 3, '10 each side', '5 min', 'Beginner', 'Home'],
    ['bird-dog', 'Bird Dog', 'Core', 40, 3, '10 each side', '5 min', 'Beginner', 'Home'],
    ['ab-wheel', 'Ab Wheel Rollout', 'Core', 60, 3, '8', '5 min', 'Advanced', 'Home'],
    ['hanging-leg-raise', 'Hanging Leg Raise', 'Core', 70, 3, '10', '6 min', 'Advanced', 'Gym'],
    ['side-plank', 'Side Plank', 'Core', 45, 3, '30 sec each side', '5 min', 'Intermediate', 'Home'],
    ['hollow-hold', 'Hollow Body Hold', 'Core', 45, 3, '20-30 sec', '5 min', 'Intermediate', 'Home'],
    ['v-ups', 'V-Ups', 'Core', 55, 3, '15', '5 min', 'Intermediate', 'Home'],

    // Full Body
    ['squat-thrust', 'Squat Thrusts', 'Full Body', 100, 3, '10', '8 min', 'Intermediate', 'Home'],
    ['kettlebell-swing', 'Kettlebell Swing', 'Full Body', 120, 3, '15', '8 min', 'Intermediate', 'Both'],
    ['thrusters', 'Thrusters', 'Full Body', 100, 3, '10', '6 min', 'Intermediate', 'Both'],
    ['clean-press', 'Clean and Press', 'Full Body', 120, 4, '8', '10 min', 'Advanced', 'Gym'],
    ['man-maker', 'Man Makers', 'Full Body', 150, 3, '5', '10 min', 'Advanced', 'Gym'],
    ['battle-ropes', 'Battle Ropes', 'Full Body', 130, 3, '30 sec', '8 min', 'Intermediate', 'Gym'],
    ['farmers-walk', "Farmer's Walk", 'Full Body', 90, 3, '30 sec', '6 min', 'Beginner', 'Both'],

    // Flexibility
    ['stretching', 'Full Body Stretching', 'Flexibility', 50, 1, '-', '15 min', 'Beginner', 'Home'],
    ['yoga', 'Yoga (Basic)', 'Flexibility', 100, 1, '-', '30 min', 'Beginner', 'Home'],
    ['yoga-power', 'Power Yoga', 'Flexibility', 180, 1, '-', '45 min', 'Intermediate', 'Home'],
    ['surya-namaskar', 'Surya Namaskar (12 rounds)', 'Flexibility', 140, 12, '1 round', '20 min', 'Intermediate', 'Home'],
    ['foam-rolling', 'Foam Rolling', 'Flexibility', 30, 1, '-', '10 min', 'Beginner', 'Home'],
    ['cat-cow-stretch', 'Cat-Cow Stretch', 'Flexibility', 20, 1, '10 reps', '5 min', 'Beginner', 'Home'],
    ['pigeon-pose', 'Pigeon Pose', 'Flexibility', 25, 1, '30 sec each side', '5 min', 'Intermediate', 'Home'],
];

async function seed() {
    console.log('\n🌱 Seeding diet_foods and diet_exercises...\n');

    const foodRows = FOODS.map(([id, name, category, calories, protein, carbs, fats, serving_size, is_veg, is_eggetarian], i) => ({
        id, name, category, calories, protein, carbs, fats, serving_size, is_veg, is_eggetarian, sort_order: i, active: true,
    }));
    await check('diet_foods', supabase.from('diet_foods').upsert(foodRows, { onConflict: 'id' }).select());

    const exerciseRows = EXERCISES.map(([id, name, muscle_group, calories_burned, sets, reps, duration, difficulty, location], i) => ({
        id, name, muscle_group, calories_burned, sets, reps, duration, difficulty, location, sort_order: i, active: true,
    }));
    await check('diet_exercises', supabase.from('diet_exercises').upsert(exerciseRows, { onConflict: 'id' }).select());

    console.log('\n✅ Diet data seeded successfully.\n');
}

seed().catch((err) => {
    console.error('\n❌ Seed failed:', err.message || err);
    process.exit(1);
});
