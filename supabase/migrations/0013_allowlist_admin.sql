-- Shopper allowlist, admin desk, and the one pending question per order.
--
-- Do not edit 0004_shared_card.sql. This file runs after it, and a person
-- applies it with npm run db:migrate. The build only checks that the file is
-- already recorded.
--
-- The rename happens while the previous deploy is still serving. The view
-- keeps the old name so a writer that has not shipped yet still has a table.
-- A later issue drops the view. New code writes allowlist, not the view.
--
-- RLS on and no policies, same as 0004: the server uses service credentials.
-- The anon key reads nothing. No password is inserted here.

alter table shared_card_member rename to allowlist;
alter table allowlist rename column address to user_id;
alter table allowlist add column coto_sandbox_enabled boolean not null default false;
alter table allowlist add column dia_manual_enabled boolean not null default false;
update allowlist set dia_manual_enabled = true;

create view shared_card_member as
  select network,
         user_id as address,
         note,
         created_at,
         coto_sandbox_enabled,
         dia_manual_enabled
    from allowlist;

create function shared_card_member_insert() returns trigger
language plpgsql as $$
begin
  insert into allowlist (network, user_id, note, coto_sandbox_enabled, dia_manual_enabled)
  values (
    new.network,
    new.address,
    new.note,
    coalesce(new.coto_sandbox_enabled, false),
    coalesce(new.dia_manual_enabled, false)
  );
  return new;
end $$;

create function shared_card_member_update() returns trigger
language plpgsql as $$
begin
  update allowlist
     set note = new.note,
         coto_sandbox_enabled = coalesce(new.coto_sandbox_enabled, coto_sandbox_enabled),
         dia_manual_enabled = coalesce(new.dia_manual_enabled, dia_manual_enabled)
   where network = old.network and user_id = old.address;
  return new;
end $$;

create function shared_card_member_delete() returns trigger
language plpgsql as $$
begin
  delete from allowlist where network = old.network and user_id = old.address;
  return old;
end $$;

create trigger shared_card_member_insert
  instead of insert on shared_card_member
  for each row execute function shared_card_member_insert();

create trigger shared_card_member_update
  instead of update on shared_card_member
  for each row execute function shared_card_member_update();

create trigger shared_card_member_delete
  instead of delete on shared_card_member
  for each row execute function shared_card_member_delete();

create table admin_user (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table admin_session (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid not null references admin_user (id),
  token_hash    text not null unique,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);

create table checkout_prompt (
  id           uuid primary key default gen_random_uuid(),
  order_id     text not null,
  field_ref    text,
  label        text not null,
  options      jsonb,
  answer       text,
  source       text not null check (source in ('agent', 'admin')),
  status       text not null check (status in ('pending', 'answered', 'cancelled')),
  created_at   timestamptz not null default now(),
  answered_at  timestamptz
);

create unique index checkout_prompt_one_pending
  on checkout_prompt (order_id) where status = 'pending';

create table admin_notification (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in (
               'missing_card', 'needs_shopper', 'needs_human', 'placed', 'failed')),
  order_id   text,
  body       text not null,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

-- Five failures per IP per 15 minutes. Counted by the login handler.
-- Not in the design sketch; the rate limit has to live in Postgres.
create table admin_login_failure (
  id         uuid primary key default gen_random_uuid(),
  ip         text not null,
  created_at timestamptz not null default now()
);

create index admin_login_failure_ip_created on admin_login_failure (ip, created_at);

alter table admin_user          enable row level security;
alter table admin_session       enable row level security;
alter table checkout_prompt     enable row level security;
alter table admin_notification  enable row level security;
alter table admin_login_failure enable row level security;
