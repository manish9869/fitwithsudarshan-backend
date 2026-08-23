-- ═══════════════════════════════════════════════════════════════════════════
-- FitWithSudarshan — full database schema (Supabase / Postgres)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Single source of truth for every table this app uses. Consolidates what
-- used to be two partial files (admin_profile_schema.sql, diet_schema.sql —
-- both now removed) plus every other table that previously existed only as
-- tribal knowledge in application code, into one script.
--
-- Reconstructed from the LIVE production schema (column names/types/
-- nullability introspected via sampled rows over the Supabase REST API —
-- this project has no direct Postgres connection string on hand, only the
-- service-role REST key, so pg_dump / information_schema weren't available)
-- cross-checked against every `.select()`/`.insert()` call in src/. Types
-- are Postgres equivalents of the observed JS values; a handful of
-- always-null columns (marked below) have their type inferred from how the
-- app writes to them rather than from a sampled value.
--
-- Safe to run top-to-bottom on a fresh database: every statement is
-- `create table if not exists` / `add column if not exists`, so re-running
-- this against a database that already has these tables is a no-op. It is
-- NOT a migration tool — there's no down/rollback and no version tracking;
-- it's a snapshot of "what the schema looks like today," meant to (a) let
-- you stand up a new environment from scratch and (b) serve as documentation
-- so nobody has to reverse-engineer table shapes from controller code again.
--
-- Requires the pgcrypto extension (gen_random_uuid()) — Supabase enables
-- this by default.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query.

-- ═══════════════════════════════════════════════════════════════════════════
-- ADMINS — coach/staff accounts for the /admin panel
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists admins (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  display_name text not null,
  role text not null default 'admin',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  -- Admin Profile page fields (formerly admin_profile_schema.sql)
  qualification text,
  contact text
);

-- ═══════════════════════════════════════════════════════════════════════════
-- ENROLLMENTS — a client's coaching plan/subscription. There is no separate
-- "plan" table: each row IS one plan period. Renewals/extensions are new
-- rows chained via root_enrollment_id (see createEnrollmentExtension in
-- manualEnrollmentController.js), not a mutation of the original row — every
-- invoice/receipt is generated from the live row at download time, so
-- editing a past period in place would retroactively change already-issued
-- documents.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists enrollments (
  id uuid primary key default gen_random_uuid(),
  enrollment_id text not null unique,          -- human-readable, e.g. FIT-2026-123456

  -- Client contact + intake details
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  age text,
  city text,
  weight text,
  goals text[],
  medical_issue text,
  medical_note text,
  -- Couple-plan partner fields (null for individual plans)
  partner_name text,
  partner_age text,
  partner_weight text,
  partner_goals text,
  partner_medical_issue text,
  partner_medical_note text,

  -- Plan definition
  program_name text not null,                  -- always computer-generated, never freehand
  plan_type text not null,                     -- 'individual' | 'couple'
  coaching_type text not null,
  duration_months text not null,
  plan_start_date timestamptz,                 -- set once at creation, never mutated;
                                                -- end date = plan_start_date + duration_months,
                                                -- always computed on the fly, never stored

  -- Money (website checkout OR manual/ledger entry — see payment_status vs.
  -- payment_plan_status below, they track two different things)
  amount_paid numeric not null default 0,
  original_amount numeric not null default 0,
  total_amount numeric not null default 0,
  balance_due numeric not null default 0,
  coupon_code text,                             -- NOT a foreign key: coupons can be hard-deleted
                                                 -- (see couponService.deleteCoupon) while past
                                                 -- enrollments still need to show the code they used
  coupon_savings numeric not null default 0,
  razorpay_order_id text,
  razorpay_payment_id text,
  payment_date timestamptz,
  payment_method text,                         -- manual entries only: 'upi' | 'bank_transfer' | 'cash' | 'other' ...
  payment_status text not null default 'pending',      -- 'pending' | 'paid' | 'failed' | 'refunded'
                                                          -- website checkout outcome — NOT plan lifecycle
  payment_plan_status text not null default 'pending',  -- 'pending' | 'partial' | 'paid_off' — ledger/installment status

  -- Origin + admin bookkeeping
  source text not null default 'website',      -- 'website' | 'manual'
  admin_note text,
  root_enrollment_id uuid references enrollments(id),  -- set on extension rows; chains renewals
                                                          -- back to the original enrollment

  -- 7-day follow-up system
  followup_status text not null default 'active',       -- 'active' | 'stopped'
  next_followup_at timestamptz,
  last_followup_at timestamptz,

  -- Balance-due reminder scheduling
  next_payment_reminder_at timestamptz,
  last_payment_reminder_at timestamptz,

  -- Soft delete — every admin-facing query MUST filter .is('deleted_at', null)
  deleted_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists idx_enrollments_created_at on enrollments(created_at);
create index if not exists idx_enrollments_root_enrollment_id on enrollments(root_enrollment_id);
create index if not exists idx_enrollments_customer_email on enrollments(customer_email);
create index if not exists idx_enrollments_deleted_at on enrollments(deleted_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- ENROLLMENT PAYMENTS — the payment ledger. One row per installment/payment
-- recorded against an enrollment; enrollments.amount_paid/balance_due are
-- kept in sync from this table (see paymentLedgerService.recomputeEnrollmentTotals).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists enrollment_payments (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  amount numeric not null,
  method text not null,                         -- 'upi' | 'bank_transfer' | 'cash' | 'razorpay' | 'other' ...
  reference text,                                -- UPI ref / bank UTR / razorpay_payment_id
  note text,
  recorded_by uuid references admins(id),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_enrollment_payments_enrollment_id on enrollment_payments(enrollment_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- FOLLOW-UPS — audit log of follow-up actions taken on an enrollment
-- (enrollments.followup_status/next_followup_at hold the CURRENT state;
-- this table is the history of how it got there).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists follow_ups (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references enrollments(id) on delete cascade,
  action text not null,                          -- e.g. 'completed' | 'snoozed' | 'stopped'
  note text,
  next_due_at timestamptz,
  created_by uuid references admins(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_follow_ups_enrollment_id on follow_ups(enrollment_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- ASSESSMENTS — the "book a free consult" intake form submissions
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists assessments (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text,
  email text not null,
  whatsapp text not null,
  age text not null,
  gender text not null,
  city text not null,
  plan text not null,
  current_weight text not null,
  height text not null,
  main_goal text not null,
  desired_result text not null,
  why_now text not null,
  profession text not null,
  workout_status text not null,
  training_location text not null,
  training_days text not null,
  food_preference text not null,
  daily_food_routine text not null,
  biggest_struggle text not null,
  sleep_hours text not null,
  medical_conditions text not null,
  commitment integer not null,                   -- 1-10 self-rated commitment score

  -- Uploaded photos/report — client uploads later via a tokenized link
  photo_upload_token uuid not null default gen_random_uuid(),
  photo_front_path text,
  photo_side_path text,
  blood_report_path text,
  files_deleted_at timestamptz,                   -- files auto-purged after a retention window

  status text not null default 'new',             -- 'new' | 'reviewed' | 'plan_sent' | 'completed' | 'archived'
  reviewed boolean not null default false,         -- standalone flag, independent of the status pipeline

  deleted_at timestamptz,                          -- soft delete — filter .is('deleted_at', null)
  created_at timestamptz not null default now()
);

create index if not exists idx_assessments_created_at on assessments(created_at);
create index if not exists idx_assessments_deleted_at on assessments(deleted_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- LEADS — "Apply For Coaching" hero-modal submissions. A cold enquiry: just
-- name/email/phone/goal, not yet a full onboarding assessment or a paid
-- enrollment. Tracked separately so the admin panel can work a follow-up
-- queue on people who haven't committed to either of those yet.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text not null,
  goal text,
  experience text,
  message text,
  status text not null default 'new',             -- 'new' | 'contacted' | 'converted' | 'not_interested'
  source text not null default 'website',
  deleted_at timestamptz,                          -- soft delete — filter .is('deleted_at', null)
  created_at timestamptz not null default now()
);

create index if not exists idx_leads_created_at on leads(created_at);
create index if not exists idx_leads_deleted_at on leads(deleted_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- ADMIN NOTES — freeform notes an admin attaches to an enrollment, assessment
-- or lead
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists admin_notes (
  id uuid primary key default gen_random_uuid(),
  record_type text not null,                      -- 'enrollment' | 'assessment' | 'lead'
  record_id uuid not null,
  note text not null,
  created_by uuid references admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_notes_record_type_check check (record_type in ('enrollment', 'assessment', 'lead'))
);

-- Pre-existing production databases already have this table (created before
-- `leads` existed) with the CHECK constraint scoped to just 'enrollment' and
-- 'assessment' — the `create table if not exists` above is a no-op there, so
-- the constraint has to be widened explicitly. Idempotent: safe to re-run.
alter table admin_notes drop constraint if exists admin_notes_record_type_check;
alter table admin_notes add constraint admin_notes_record_type_check
  check (record_type in ('enrollment', 'assessment', 'lead'));

create index if not exists idx_admin_notes_record on admin_notes(record_type, record_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- TRANSACTION LOGS — audit trail of every Razorpay checkout step (order
-- created, payment verified, webhook received, failures) for support/debugging
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists transaction_logs (
  id uuid primary key default gen_random_uuid(),
  razorpay_order_id text,
  razorpay_payment_id text,
  enrollment_id text,                             -- enrollments.enrollment_id (text code), not the uuid PK
  step text not null,                             -- 'order_created' | 'payment_verified' | 'webhook' | ...
  status text not null,                           -- 'success' | 'failed' | 'pending'
  message text,
  metadata jsonb,
  source text not null default 'website',
  created_at timestamptz not null default now()
);

create index if not exists idx_transaction_logs_created_at on transaction_logs(created_at);
create index if not exists idx_transaction_logs_enrollment_id on transaction_logs(enrollment_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- COUPONS
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  description text not null,
  type text not null,                             -- 'percent' | 'flat' | 'fixed_price'
  percent integer,
  flat numeric,
  fixed_prices jsonb,                              -- { "<coachingType>:<planType>:<durationMonths>": price }
  applicable_coaching_types text[] not null default '{}',
  applicable_plan_types text[] not null default '{}',
  applicable_durations text[] not null default '{}',
  max_uses integer,
  used_count integer not null default 0,
  starts_at timestamptz,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- CMS / SITE CONTENT — everything editable from Admin → CMS pages
-- ═══════════════════════════════════════════════════════════════════════════

-- Generic key/value store for site-wide settings + free-form content blocks
-- (maintenance mode flag, diet_guidelines default text, etc).
create table if not exists site_content (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists coaching_types (
  id text primary key,
  name text not null,
  short_name text not null,
  tagline text not null,
  description text not null,
  features text[] not null default '{}',
  note text,
  cta text not null,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table if not exists durations (
  months text primary key,
  label text not null,
  sublabel text not null,
  description text not null,
  popular boolean not null default false,
  on_sale boolean not null default false,
  sort_order integer not null default 0
);

-- Coaching type × plan type × duration price matrix
create table if not exists pricing (
  id uuid primary key default gen_random_uuid(),
  coaching_type_id text not null references coaching_types(id),
  plan_type text not null,                        -- 'individual' | 'couple'
  duration_months text not null,
  price numeric not null,
  unique(coaching_type_id, plan_type, duration_months)
);

create table if not exists basic_consultation (
  id integer primary key default 1,
  name text not null,
  tagline text not null,
  description text not null,
  price_individual numeric not null,
  price_couple numeric not null,
  original_price_individual numeric not null,
  original_price_couple numeric not null,
  sale_label text,
  features text[] not null default '{}'
);

create table if not exists services (
  id text primary key,
  title text not null,
  subtitle text not null,
  features text[] not null default '{}',
  badge text,
  color text not null,
  accent text not null,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table if not exists recode_method (
  id uuid primary key default gen_random_uuid(),
  step text not null,
  title text not null,
  description text not null,
  color text not null,
  accent text not null,
  sort_order integer not null default 0
);

create table if not exists testimonials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  transformation text not null,
  weight_lost text not null,
  quote text not null,
  rating integer not null default 5,
  avatar text,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table if not exists transformations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  duration text not null,
  weight_lost text not null,
  category text not null,
  quote text not null,
  stats jsonb not null default '{}',
  photo_before text not null,
  photo_after text not null,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table if not exists blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text not null,
  category text not null,
  read_time text not null,
  post_date text not null,
  image text not null,
  content text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists faqs (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  question text not null,
  answer text not null,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table if not exists legal_pages (
  slug text primary key,                          -- 'terms' | 'privacy-policy' | 'refund-policy'
  title text not null,
  last_updated text not null,
  intro text not null,
  sections jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- DIET & WORKOUT PLAN BUILDER
-- ═══════════════════════════════════════════════════════════════════════════

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
  sort_order integer not null default 0,
  active boolean not null default true,
  -- Structured serving amount/unit (grams, ml, oz, cup/bowl sizes, katori...)
  -- — falls back to the legacy serving_size text until an admin edits a food.
  serving_qty numeric default 1,
  serving_unit text,
  -- Secondary nutrition facts (from the Indian Food Composition dataset)
  sugar numeric,
  fiber numeric,
  sodium numeric,
  calcium numeric,
  iron numeric,
  vitamin_c numeric,
  folate numeric,
  -- Regional/cuisine classification — fixed set maintained in dietRegions.js
  region text not null default 'Generic / Pan-Indian',
  -- Cheap-staples tag for budget-conscious clients
  is_budget_friendly boolean not null default false
);

create table if not exists diet_exercises (
  id text primary key,
  name text not null,
  muscle_group text not null,
  calories_burned numeric not null default 0,
  sets integer not null default 0,
  reps text,
  duration text,
  difficulty text,
  location text,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table if not exists diet_plans (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid references enrollments(id) on delete set null,
  client_name text not null,
  client_age integer,
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
  plan_duration integer not null default 7,
  include_exercise boolean not null default true,
  status text not null default 'draft',
  -- Manual calorie target override — null = use the auto-calculated BMR/TDEE estimate
  target_calories numeric,
  target_calories_manual boolean not null default false,
  -- Mirrors the client's chosen region (null = no preference)
  client_cuisine text,
  -- When true, Build Plan only edits Day 1 and the PDF prints just that one
  -- day instead of repeating it plan_duration times (hostel/PG clients who
  -- eat the same thing daily).
  repeat_daily boolean not null default false,
  -- Null = use the global default (site_content key 'diet_guidelines'). Set
  -- = this plan's PDF prints these lines instead.
  guidelines jsonb,
  client_budget_conscious boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists diet_plan_days (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references diet_plans(id) on delete cascade,
  day_number integer not null,
  meals jsonb not null default '[]',      -- [ { type, label, foodIds: [...] }, ... ]
  exercises jsonb not null default '[]',  -- [ exerciseId, ... ]
  rest_day boolean not null default false,
  notes text,
  unique(plan_id, day_number)
);

-- DB-backed quick-start templates for the diet plan wizard.
-- days: [ { meals: [ { type, label, foodIds: [...] } ], restDay?: true }, ... ]
-- One entry per day-in-rotation; a plan longer than the array repeats it
-- (day 8 of a 30-day plan reuses entry 0, etc). Food ids must exist in diet_foods.
create table if not exists diet_templates (
  id text primary key,
  name text not null,
  description text,
  goal text,
  diet_preference text,
  region text,
  days jsonb not null default '[]',
  sort_order integer not null default 0,
  active boolean not null default true
);

-- exercise_days: [ ["push-ups","squats",...], ["lunges",...], ... ] — one
-- array of exercise ids per day-in-rotation, same repeat-by-modulo rule.
-- Exercise ids must exist in diet_exercises.
create table if not exists diet_workout_templates (
  id text primary key,
  name text not null,
  description text,
  exercise_days jsonb not null default '[]',
  sort_order integer not null default 0,
  active boolean not null default true
);

create index if not exists idx_diet_plan_days_plan_id on diet_plan_days(plan_id);
create index if not exists idx_diet_plans_enrollment_id on diet_plans(enrollment_id);
create index if not exists idx_diet_templates_sort on diet_templates(sort_order);
create index if not exists idx_diet_workout_templates_sort on diet_workout_templates(sort_order);
