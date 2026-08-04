-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New Query)
-- before running `node src/scripts/seedDietData.js` or using the Diet Plans
-- admin page. Safe to keep in the repo as a reference — not executed by any script.

create table if not exists diet_foods (
  id text primary key,
  name text not null,
  category text not null,
  calories numeric not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fats numeric not null default 0,
  serving_size text,
  is_veg boolean not null default true,
  is_eggetarian boolean not null default true,
  sort_order int not null default 0,
  active boolean not null default true
);

create table if not exists diet_exercises (
  id text primary key,
  name text not null,
  muscle_group text not null,
  calories_burned numeric not null default 0,
  sets int not null default 0,
  reps text,
  duration text,
  difficulty text,
  location text,
  sort_order int not null default 0,
  active boolean not null default true
);

create table if not exists diet_plans (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid references enrollments(id) on delete set null,
  client_name text not null,
  client_age int,
  client_gender text,
  client_height numeric,
  client_weight numeric,
  target_weight numeric,
  goal text,
  diet_preference text,
  activity_level text,
  allergies text,
  client_notes text,
  trainer_name text,
  trainer_qualification text,
  trainer_contact text,
  plan_duration int not null default 7,
  include_exercise boolean not null default true,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists diet_plan_days (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references diet_plans(id) on delete cascade,
  day_number int not null,
  meals jsonb not null default '[]',
  exercises jsonb not null default '[]',
  rest_day boolean not null default false,
  notes text,
  unique(plan_id, day_number)
);

create index if not exists idx_diet_plan_days_plan_id on diet_plan_days(plan_id);
create index if not exists idx_diet_plans_enrollment_id on diet_plans(enrollment_id);

-- ── v2: precise serving units + manual calorie target ───────────────────────
-- Run this block once in the Supabase SQL editor to pick up:
--   - a structured serving amount/unit on each food (grams, ml, oz,
--     cup/bowl sizes, katori, etc.) instead of only a free-text label like
--     "1 cup", which is ambiguous about the actual size.
--   - an optional admin-set calorie target per plan, instead of always
--     using the auto-calculated BMR/TDEE estimate.
-- Existing rows are untouched — serving_unit is null until an admin edits
-- that food, and the app falls back to the legacy serving_size text until then.

alter table diet_foods add column if not exists serving_qty numeric default 1;
alter table diet_foods add column if not exists serving_unit text;

alter table diet_plans add column if not exists target_calories numeric;
alter table diet_plans add column if not exists target_calories_manual boolean not null default false;

-- ── v3: extended nutrition facts ────────────────────────────────────────────
-- Adds the secondary nutrients present in the Indian Food Composition dataset
-- used to rebuild diet_foods (sugar/fiber for everyday tracking; sodium/
-- calcium/iron/vitamin C/folate for the food library's detail view). All per
-- the same base serving_qty/serving_unit as calories/protein/carbs/fats.
alter table diet_foods add column if not exists sugar numeric;
alter table diet_foods add column if not exists fiber numeric;
alter table diet_foods add column if not exists sodium numeric;
alter table diet_foods add column if not exists calcium numeric;
alter table diet_foods add column if not exists iron numeric;
alter table diet_foods add column if not exists vitamin_c numeric;
alter table diet_foods add column if not exists folate numeric;

-- ── v4: regional/cuisine classification ──────────────────────────────────
-- Lets an admin browse/filter the food library by regional cuisine (e.g.
-- only show Gujarati food for a Gujarati client) instead of one flat list.
-- Values are a fixed set maintained in the frontend (dietRegions.js) —
-- 'Generic / Pan-Indian' is the default/catch-all for dishes eaten broadly
-- across India or that don't fit one region.
alter table diet_foods add column if not exists region text not null default 'Generic / Pan-Indian';

-- ── v5: client cuisine preference + repeating-day plans ──────────────────
-- client_cuisine: mirrors the client's chosen region (null = no preference)
-- so it's remembered next time the plan is opened, same pattern as
-- diet_preference/goal already being plain columns on this row.
-- repeat_daily: when true, `days` still holds plan_duration entries (kept
-- mirrored to Day 1 by the frontend) but Build Plan only lets the admin
-- edit Day 1, and the PDF prints just that one day instead of repeating it
-- plan_duration times — for clients who eat the same thing daily (hostel/
-- PG students, tight schedules) instead of a different plan each day.
alter table diet_plans add column if not exists client_cuisine text;
alter table diet_plans add column if not exists repeat_daily boolean not null default false;

-- ── v6: per-plan guideline override ───────────────────────────────────────
-- Null = use the global default (site_content key 'diet_guidelines', set in
-- Admin -> Site Settings). Set = this specific plan's PDF prints these
-- lines instead, for a client who needs different advice (e.g. an injury,
-- a medical restriction) without changing what every other plan shows.
alter table diet_plans add column if not exists guidelines jsonb;

-- ── v7: diet plan templates, DB-backed ────────────────────────────────────
-- The "Use Template" quick-start step used to read from a hardcoded JS file
-- — moved here so an admin can edit the 5 built-in templates or add new
-- ones from Admin -> Diet Templates, and they show up in the wizard
-- immediately with no code change/deploy.
--
-- days: same shape the wizard already worked with —
--   [ { meals: [ { type, label, foodIds: [...] } ], restDay?: true }, ... ]
-- One array entry per day-in-rotation; a plan longer than the array repeats
-- it (day 8 of a 30-day plan reuses entry 0, etc). Food ids must exist in
-- diet_foods (Admin -> Diet Foods).
create table if not exists diet_templates (
  id text primary key,
  name text not null,
  description text,
  goal text,
  diet_preference text,
  region text,
  days jsonb not null default '[]',
  sort_order int not null default 0,
  active boolean not null default true
);

-- exercise_days: [ ["push-ups","squats",...], ["lunges",...], ... ] — one
-- array of exercise ids per day-in-rotation, same repeat-by-modulo rule as
-- diet_templates.days. Exercise ids must exist in diet_exercises.
create table if not exists diet_workout_templates (
  id text primary key,
  name text not null,
  description text,
  exercise_days jsonb not null default '[]',
  sort_order int not null default 0,
  active boolean not null default true
);

create index if not exists idx_diet_templates_sort on diet_templates(sort_order);
create index if not exists idx_diet_workout_templates_sort on diet_workout_templates(sort_order);

-- ── v8: budget-friendly food tag ──────────────────────────────────────────
-- Lets an admin mark cheap staples (dal, rice, seasonal veg, eggs) so a
-- student/tight-budget client's plan builder can filter to those, the same
-- way client_cuisine already narrows by region. Purely a tag the admin sets
-- per food — not derived from price data (none exists in this schema).
alter table diet_foods add column if not exists is_budget_friendly boolean not null default false;
alter table diet_plans add column if not exists client_budget_conscious boolean not null default false;
