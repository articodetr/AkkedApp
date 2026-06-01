/*
  Enable email OTP confirmation for new signups.

  The hosted Supabase project must also have Confirm email enabled from:
  Authentication -> Providers -> Email.
*/

begin;

-- Remove the legacy database override that confirmed every email signup before
-- Supabase Auth could send a confirmation OTP.
drop trigger if exists before_auth_user_auto_confirm_email on auth.users;
drop function if exists public.auto_confirm_email_signup();

-- Remove a development-only override found on the hosted project. It replaced
-- Supabase's generated token hash with the hash for 000000, so the six-digit
-- code shown in the confirmation email could never be verified.
drop trigger if exists dev_fixed_otp_auth_users on auth.users;
drop function if exists public.dev_set_fixed_otp_auth_users();

-- Old app builds used these SECURITY DEFINER RPCs to create confirmed users
-- directly. Keep the functions for migration history, but block public use so
-- every new signup goes through Supabase Auth and its email OTP flow.
do $$
begin
  if to_regprocedure('public.register_app_user(text,text,text,text)') is not null then
    execute 'revoke execute on function public.register_app_user(text, text, text, text) from public, anon, authenticated';
  end if;

  if to_regprocedure('public.login_app_user(text,text)') is not null then
    execute 'revoke execute on function public.login_app_user(text, text) from public, anon, authenticated';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
