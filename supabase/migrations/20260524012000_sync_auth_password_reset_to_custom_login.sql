/*
  Sync Supabase Auth password resets back to custom login.

  The app logs in through app_security.pin_hash. Password recovery updates
  auth.users.encrypted_password, so this trigger copies the new hash back into
  app_security for the same user.
*/

begin;

create or replace function public.sync_auth_password_to_app_security()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.app_security security_user
    set pin_hash = new.encrypted_password,
        updated_at = now()
    where security_user.id = new.id
       or (
         new.email is not null
         and security_user.email is not null
         and lower(security_user.email) = lower(new.email)
       );
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_password_updated on auth.users;
create trigger on_auth_user_password_updated
  after update of encrypted_password on auth.users
  for each row
  execute function public.sync_auth_password_to_app_security();

notify pgrst, 'reload schema';

commit;
