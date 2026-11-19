-- A random analytics id per wallet row, for product analytics (PostHog).
--
-- It is the `distinct_id` a signed-in wallet is identified by, so the raw
-- address never leaves for an analytics vendor. Random, not derived from the
-- address: there is no salt to keep, and Pollar gives email and Google users a
-- different wallet per network, so an address does not join networks anyway.
-- One id per (network, address) row, never shared across networks, hence the
-- unique index.
--
-- Nullable. registerWallet() in apps/web/lib/wallet-record.ts sets it with
-- gen_random_uuid() when it inserts a row at login, and on an existing row's
-- next login when it is missing. Once set it does not change.
--
-- The way back to the address is a server-side query only:
--   select network, address from wallet where analytics_id = $1
-- Same guard as the rest of `wallet`: RLS on, no policies.

alter table wallet add column analytics_id uuid;

create unique index wallet_analytics_id_key on wallet (analytics_id);
