begin;

alter table if exists public.account_movements
  add column if not exists pending_approval boolean default false;

alter table if exists public.account_movements
  add column if not exists approval_status text default 'approved';

alter table if exists public.account_movements
  add column if not exists approved_at timestamptz;

alter table if exists public.account_movements
  add column if not exists approved_by_user_id uuid;

alter table if exists public.account_movements
  add column if not exists reject_reason text;

alter table if exists public.account_movements
  add column if not exists mirror_movement_id uuid;

drop function if exists public.approve_movement(uuid, text);
drop function if exists public.reject_movement_with_reason(uuid, text, text);

create or replace function public.approve_movement(
  p_movement_id uuid,
  p_user_name text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_movement record;
  v_actor_user_id uuid;
begin
  select id
  into v_actor_user_id
  from public.users
  where user_name = p_user_name
  limit 1;

  if v_actor_user_id is null then
    raise exception 'User not found';
  end if;

  select
    id,
    mirror_movement_id,
    approval_status,
    pending_approval
  into v_movement
  from public.account_movements
  where id = p_movement_id
  limit 1;

  if v_movement.id is null then
    raise exception 'Movement not found';
  end if;

  if coalesce(v_movement.approval_status, 'approved') <> 'pending' then
    raise exception 'Movement is not pending approval';
  end if;

  update public.account_movements
  set
    pending_approval = false,
    approval_status = 'approved',
    approved_by_user_id = v_actor_user_id,
    approved_at = now(),
    reject_reason = null
  where id = v_movement.id
     or id = v_movement.mirror_movement_id;

  return jsonb_build_object(
    'success', true,
    'message', 'Movement approved successfully'
  );
end;
$$;

create or replace function public.reject_movement_with_reason(
  p_movement_id uuid,
  p_user_name text,
  p_reject_reason text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_movement record;
begin
  if trim(coalesce(p_reject_reason, '')) = '' then
    raise exception 'Reject reason is required';
  end if;

  select
    id,
    mirror_movement_id,
    approval_status,
    pending_approval
  into v_movement
  from public.account_movements
  where id = p_movement_id
  limit 1;

  if v_movement.id is null then
    raise exception 'Movement not found';
  end if;

  if coalesce(v_movement.approval_status, 'approved') <> 'pending' then
    raise exception 'Movement is not pending approval';
  end if;

  update public.account_movements
  set
    pending_approval = false,
    approval_status = 'rejected',
    reject_reason = trim(p_reject_reason),
    approved_at = null,
    approved_by_user_id = null
  where id = v_movement.id
     or id = v_movement.mirror_movement_id;

  return jsonb_build_object(
    'success', true,
    'message', 'Movement rejected successfully'
  );
end;
$$;

grant execute on function public.approve_movement(uuid, text) to anon, authenticated, service_role;
grant execute on function public.reject_movement_with_reason(uuid, text, text) to anon, authenticated, service_role;

commit;