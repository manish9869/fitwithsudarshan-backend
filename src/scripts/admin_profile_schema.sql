-- Run this once in the Supabase SQL editor before using the Admin Profile page.
alter table admins add column if not exists qualification text;
alter table admins add column if not exists contact text;
