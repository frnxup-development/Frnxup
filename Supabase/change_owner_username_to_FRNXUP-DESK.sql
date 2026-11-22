-- FRNXUP OWNER USERNAME CHANGE
-- Run in the Supabase SQL Editor for the Frnxup project.
-- Updates only the owner profile username. Does not change role, email, or display name.

DO $$
DECLARE
  target_user_id CONSTANT uuid := 'c2ac4011-44a6-42e6-a214-2264a58f516c';
  target_email CONSTANT text := 'frnxup@gmail.com';
  new_username CONSTANT text := 'FRNXUP-DESK';
BEGIN
  -- Confirm this UUID and email still refer to the intended Auth account.
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = target_user_id AND lower(email) = lower(target_email)
  ) THEN
    RAISE EXCEPTION 'Owner account confirmation failed. No changes made.';
  END IF;

  -- Ensure the requested username is not already owned by another profile.
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = lower(new_username)
      AND id <> target_user_id
  ) THEN
    RAISE EXCEPTION 'Username FRNXUP-DESK is already in use. No changes made.';
  END IF;

  -- Update only the owner's username.
  UPDATE public.profiles
  SET username = new_username,
      updated_at = now()
  WHERE id = target_user_id;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owner profile not found. Restore owner profile first; no username changed.';
  END IF;
END $$;


-- Verify the updated username.
SELECT u.email, p.id AS profile_id, p.username, p.role, p.account_status
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
WHERE u.id = 'c2ac4011-44a6-42e6-a214-2264a58f516c'::uuid
  AND lower(u.email) = lower('frnxup@gmail.com');
