-- Which testnet USDC the shopper's balance line shows, one key per session kind.
--
-- `usdc_source_guest` is read for a request with no signed-in session.
-- `usdc_source_signed_in` is read for a request carrying a valid `chg_user`
-- cookie. The server picks the key from the session, never from the request.
-- The two are independent: neither is a fallback for the other.
--
-- Values are JSON strings, `"mock"` (our SEP-41 token, the one the faucet
-- mints and the escrow holds) or `"circle"` (Circle's testnet USDC). Anything
-- else, a missing row, a missing table or no database reads as mock. The flag
-- only picks what the balance line shows: checkout, the escrow and the faucet
-- stay on the mock under either value.
--
-- `do nothing` on conflict so a re-run keeps an operator's choice.

insert into config (key, value) values
  ('usdc_source_guest',     '"mock"'::jsonb),
  ('usdc_source_signed_in', '"mock"'::jsonb)
  on conflict (key) do nothing;
