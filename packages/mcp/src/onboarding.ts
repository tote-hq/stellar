import { fileURLToPath } from 'node:url';

import type { AppConfig } from './config.js';

/**
 * The first-run surface.
 *
 * A user of this server does not have the repository open. They registered a
 * command in an MCP client and started talking. So "see SETUP.md" is useless to
 * them unless we say *where* SETUP.md is, and a tool surface of many functions
 * is useless to the model unless something says which order they go in. Both
 * of those are what this file is for.
 *
 * Everything here is pure and string-shaped so it can be asserted on.
 */

/** Absolute path to the setup guide, wherever this happens to be installed. */
export function setupGuidePath(): string {
  return fileURLToPath(new URL('../SETUP.md', import.meta.url));
}

/** A pointer a person can actually follow, unlike a bare filename. */
export function setupRef(section: string): string {
  return `See ${setupGuidePath()} — "${section}".`;
}

/**
 * Sent to the MCP client at connect time and shown to the model once per
 * session, so it pays for itself only if it is short. It covers what the tool
 * descriptions cannot: the order, and the rules that must not be broken.
 */
export const SERVER_INSTRUCTIONS = `
Search Argentine supermarkets and build a cart in the user's own account.
The checkout tools drive a real Día checkout as far as the payment form and
stop. This server does not pay and does not create a card.

TWO HALVES.
  Read-only (works immediately, no setup): set_location → search_products →
  price_check → add_to_cart → get_cart_link. This ends at a link the user opens.
  Checkout (needs setup, Día only): the ordered flow below.

THE CHECKOUT FLOW IS ORDERED. Each tool refuses until the one before it has run,
and names what is missing:
  link_marketplace_account → set_delivery_address → build_cart → review_order

review_order walks the real checkout to the payment step and shows the total.
It does not type a card and it does not submit a payment. The user pays in
their own browser from the cart link, if they choose to.

START WITH diagnose. On a fresh install it prints what is still missing and the
next concrete step. If a tool reports a configuration problem, run diagnose rather
than guessing.

TWO RULES THAT ARE NOT NEGOTIABLE.
  1. Never ask the user for their supermarket password, and never offer to type it.
     link_marketplace_account opens a real browser window and they type it there.
     This server never sees it.
  2. Never ask the user for their name or DNI, or for a card number. Name and DNI are
     already on their store profile. A card number is not something this server
     collects or types.

If a tool escalates with a question, put it to the user — that is the designed
behaviour, not a failure.
`.trim();

/**
 * Instructions for a server that registers only the catalog tools.
 *
 * Kept separate rather than trimmed at runtime because instructions are a
 * promise: naming a checkout tool to a host that never registered it sends
 * the model to call a tool that does not exist. A read-only server has a
 * different, shorter story, and the honest part of it is where it stops.
 */
export const CATALOG_INSTRUCTIONS = `
Search Argentine supermarkets and build a real cart, then hand the user a link that
opens that exact cart on the supermarket's own site.

THE FLOW IS ORDERED:
  set_location -> search_products -> price_check -> add_to_cart -> get_cart_link

set_location comes first and everything else fails without it. Prices and stock in
Argentina vary by branch, so a result with no postal code behind it is not a price.
Ask the user for their postal code; never guess one.

search_products returns SKU ids. add_to_cart takes those, not product names, and
not productId. Pass the seller it reported too — do not assume "1".

THIS SERVER DOES NOT BUY ANYTHING. get_cart_link is where it stops: the user opens
the link, reviews the cart and pays. Never tell them an order has been placed, and
never ask for a password, a card number, a name or a DNI. Nothing here needs them.

price_check changes nothing and creates no cart. Use it freely to confirm a price
before committing to it.
`.trim();

export interface SetupStep {
  n: number;
  label: string;
  done: boolean;
  /** What to do when it is not done. Absent once it is. */
  next?: string;
}

export interface ReadinessInput {
  cfg: AppConfig;
  sessionExists: boolean;
  sessionPassphraseSet: boolean;
}

/**
 * What is configured, what is not, and the single next thing to do about it.
 *
 * The checkout tools need a linked store session. Search does not.
 */
export function readiness(input: ReadinessInput): SetupStep[] {
  const { cfg: _cfg, sessionExists, sessionPassphraseSet } = input;
  void _cfg;
  const guide = setupGuidePath();

  return [
    {
      n: 1,
      label: 'Store account linked',
      done: sessionExists,
      next: sessionPassphraseSet
        ? 'Run link_marketplace_account. A browser window opens and you log in yourself.'
        : `Set SESSION_PASSPHRASE (8+ characters) in your MCP client's env block, restart it, then run link_marketplace_account. ${guide} — "Linking your Día account".`,
    },
  ];
}

/** Whether the checkout tools can run: a store session is linked. */
export const canPurchase = (steps: SetupStep[]): boolean => steps.every((s) => s.done);

export function renderReadiness(steps: SetupStep[]): string {
  const lines = steps.map((s) => `  ${s.done ? '✓' : '·'} ${s.n}. ${s.label}`);
  const pending = steps.filter((s) => !s.done);

  const out = ['Setup', ...lines, ''];

  if (!pending.length) {
    out.push('Everything is configured. Start with set_location, then search_products.');
    return out.join('\n');
  }

  const first = pending[0]!;
  out.push(`NEXT — ${first.label.toLowerCase()}:`, `  ${first.next}`);
  out.push(
    '',
    'Search and price comparison work right now regardless — set_location, then search_products.',
  );
  return out.join('\n');
}
