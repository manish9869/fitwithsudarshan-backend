-- ═══════════════════════════════════════════════════════════════════════════
-- WHATSAPP MARKETING — contacts, groups, broadcasts, day-wise sequences, queue
--
-- Run once in: Supabase Dashboard → SQL Editor → New Query.
-- Idempotent (if not exists everywhere) — safe to re-run.
-- Also appended to schema.sql so a fresh environment gets it too.
-- ═══════════════════════════════════════════════════════════════════════════

-- One row per phone number (digits only, with country code: 919876543210).
create table if not exists wa_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  phone text not null unique,
  tags text[] not null default '{}',        -- 'client' | 'active' | 'expired' | 'lead' | 'assessment' | any custom tag
  source text not null default 'manual',    -- 'manual' | 'import' | 'enrollment' | 'lead' | 'assessment'
  opted_out boolean not null default false, -- never message again (they asked to stop)
  opted_out_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_wa_contacts_tags on wa_contacts using gin(tags);

create table if not exists wa_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists wa_group_members (
  group_id uuid not null references wa_groups(id) on delete cascade,
  contact_id uuid not null references wa_contacts(id) on delete cascade,
  added_at timestamptz not null default now(), -- "Day 1" for sequences that start when someone joins
  primary key (group_id, contact_id)
);
create index if not exists idx_wa_group_members_contact on wa_group_members(contact_id);

-- One-off broadcast.
create table if not exists wa_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  body text not null,                        -- supports {{name}} / {{first_name}}
  image_url text,
  cta_label text,
  cta_url text,
  -- { groupIds: [], tags: [], contactIds: [], excludeContactIds: [] }
  audience jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz,                 -- null = send now
  status text not null default 'draft',      -- 'draft' | 'scheduled' | 'queued' | 'cancelled'
  meta_template_name text,                   -- approved Meta template (auto mode only)
  meta_template_lang text default 'en',
  queued_at timestamptz,
  created_at timestamptz not null default now()
);

-- Day-wise drip: step N goes out on day N for each member of the group.
create table if not exists wa_sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  group_id uuid references wa_groups(id) on delete set null,
  start_mode text not null default 'joined', -- 'joined' (day 1 = day they joined the group) | 'fixed'
  start_date date,                           -- used when start_mode = 'fixed'
  excluded_contact_ids uuid[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists wa_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references wa_sequences(id) on delete cascade,
  day_number int not null check (day_number >= 1),
  body text not null,
  image_url text,
  cta_label text,
  cta_url text,
  meta_template_name text,
  meta_template_lang text default 'en',
  created_at timestamptz not null default now(),
  unique (sequence_id, day_number)
);

-- Queue + send log. The two unique constraints make queue-building
-- idempotent: re-running the daily job never double-sends. (NULLs are
-- distinct in Postgres, so campaign rows don't collide on step_id etc.)
create table if not exists wa_messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references wa_contacts(id) on delete set null,
  phone text not null,
  name text,
  campaign_id uuid references wa_campaigns(id) on delete cascade,
  sequence_id uuid references wa_sequences(id) on delete cascade,
  step_id uuid references wa_sequence_steps(id) on delete cascade,
  body text not null,                        -- already personalised
  image_url text,
  cta_label text,
  cta_url text,
  meta_template_name text,
  meta_template_lang text,
  scheduled_date date not null,              -- IST calendar day it's due
  status text not null default 'pending',    -- 'pending' | 'sent' | 'skipped' | 'failed'
  channel text,                              -- 'assisted' (sent by hand via WhatsApp) | 'api'
  sent_at timestamptz,
  error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  unique (campaign_id, contact_id),
  unique (step_id, contact_id)
);
create index if not exists idx_wa_messages_status_date on wa_messages(status, scheduled_date);
