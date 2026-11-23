-- Fix appeal submission: the account-appeal Edge Function uses the service_role
-- client to insert appeal records. The earlier grant migration allowed SELECT and
-- UPDATE only, so INSERT was denied at stage appeal-record-insert.
grant insert on table public.account_appeals to service_role;

-- Keep the existing admin/service-role read and update privileges explicit.
grant select, update on table public.account_appeals to service_role;
