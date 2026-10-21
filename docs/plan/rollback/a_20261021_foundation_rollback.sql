BEGIN;

-- A0 rollback script: undo the shared foundation objects created for Plan A.
-- Run in a Supabase SQL editor only after confirming the objects are no longer needed.

DROP FUNCTION IF EXISTS public.get_public_settings();
DROP FUNCTION IF EXISTS public.get_setting(TEXT);
DROP FUNCTION IF EXISTS public.admin_set_setting(TEXT, JSONB);
DROP FUNCTION IF EXISTS public.is_admin(UUID);
DROP FUNCTION IF EXISTS public.is_premium_now(UUID);
DROP FUNCTION IF EXISTS public.premium_status(UUID);
DROP FUNCTION IF EXISTS public.grant_ai_bonus(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.get_ai_status();

DROP TABLE IF EXISTS public.ai_daily_usage CASCADE;
DROP TABLE IF EXISTS public.admin_audit_log CASCADE;
DROP TABLE IF EXISTS public.admin_users CASCADE;
DROP TABLE IF EXISTS public.app_settings CASCADE;

COMMIT;

-- If you also created the additional A0 values in `profiles` or triggers outside the
-- project SQL reset, drop those objects separately in the exact migration order you used.
-- This file is intentionally conservative and only contains the core shared foundation.

