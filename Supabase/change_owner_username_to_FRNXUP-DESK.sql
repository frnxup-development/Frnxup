-- FRNXUP OWNER USERNAME CHANGE (FIXED)
-- The existing profiles_username_check rejected hyphens.
-- This migration permits letters, numbers, underscores, and hyphens (3-24 chars),
-- then changes the confirmed owner username to FRNXUP-DESK.
-- Run in the Frnxup Supabase SQL Editor.

BEGIN;


-- Verify the exact owner account before modifying anything.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = 'c2ac4011-44a6-42e6-a214-2264a58f516c'::uuid
      AND lower(email) = lower('frnxup@gmail.com')
  ) THEN
    RAISE EXCEPTION 'Owner account confirmation failed. No changes made.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = lower('FRNXUP-DESK')
      AND id <> 'c2ac4011-44a6-42e6-a214-2264a58f516c'::uuid
  ) THEN
    RAISE EXCEPTION 'FRNXUP-DESK is already used by another profile. No changes made.';
  END IF;
END $$;


-- Replace the username constraint to allow hyphens as well as the existing
-- letters, numbers, and underscore. Existing username values remain valid.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_check
  CHECK (username ~ '^[A-Za-z0-9_-]{3,24}$');


-- Update only the owner's username; keep role, status, email, bio, and IDs intact.
UPDATE public.profiles
SET username = 'FRNXUP-DESK',
    updated_at = now()
WHERE id = 'c2ac4011-44a6-42e6-a214-2264a58f516c'::uuid;


-- Verify the final row.
SELECT u.email, p.id AS profile_id, p.username, p.role, p.account_status
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
WHERE u.id = 'c2ac4011-44a6-42e6-a214-2264a58f516c'::uuid
  AND lower(u.email) = lower('frnxup@gmail.com');

COMMIT;
