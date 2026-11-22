-- Frnxup Admin Control: service-role privileges for admin-only records.
-- Run this migration in the Supabase SQL Editor for project jsjlcunuvkizbeeoewsk.
-- The admin-control Edge Function uses the service_role key after authenticating
-- and authorizing the signed-in owner/admin. RLS remains enabled for browser users.

grant usage on schema public to service_role;

-- Appeals: admins list and review records.
grant select, update on table public.account_appeals to service_role;

-- Verification: admins list and approve/reject requests.
grant select, update on table public.verification_requests to service_role;

-- Audit trail: admins read logs and the Edge Function inserts an entry for each action.
grant select, insert on table public.admin_audit_logs to service_role;

-- Market boosts: admins list payment records and approve/reject boosts.
grant select, update on table public.market_boosts to service_role;
