'use client';

import type { Cart } from '@changuito/mcp/types';

import type { CotoPayGateName } from '../lib/checkout/coto-pay-gate.ts';
import { RETAILER_NAMES } from '../lib/retailers.ts';

import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';

/**
 * The basket as the store itself reports it, including its complaints.
 *
 * `messages` is where VTEX says a price moved or an item went out of stock
 * between search and cart. Hiding those would mean showing a total the user
 * is not going to be charged.
 */
export function CartCard({
  cart,
  handoffUrl,
  onPay,
  cotoGate,
}: {
  cart: Cart;
  handoffUrl?: string;
  onPay?: (cart: Cart) => void;
  /** Set on a Coto basket. `pay` is the button; every other name is the phrase. */
  cotoGate?: CotoPayGateName;
}) {
  const lang = useLang();
  const copy = uiCopy(lang).cart;
  const gates = uiCopy(lang).cotoGate;
  const unavailable = cart.lines.filter((l) => !l.available);
  const store = RETAILER_NAMES[cart.retailer] ?? cart.retailer;
  const coto = cart.retailer === 'coto';
  const title = coto ? copy.cotoTitle : cart.retailer === 'dia' ? copy.diaTitle : copy.title;
  return (
    <section className="cart" aria-label={copy.aria} data-testid={coto ? 'cart-coto' : 'cart-card'}>
      <header className="cart-head">
        <span className="cart-title">{title}</span>
        <span className="cart-retailer">{store}</span>
      </header>

      <ul className="cart-lines">
        {cart.lines.map((l) => (
          <li key={l.index} className={l.available ? 'cart-line' : 'cart-line is-oos'}>
            <span className="cart-qty">{l.quantity}×</span>
            <span className="cart-name">{l.name}</span>
            <span className="cart-amount">{l.lineTotal.display}</span>
          </li>
        ))}
      </ul>

      {cart.messages.length > 0 ? (
        <ul className="cart-notes">
          {cart.messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : null}

      <footer className="cart-foot">
        <div className="cart-total">
          <span>{copy.total}</span>
          <strong>{cart.total.display}</strong>
        </div>
        {unavailable.length > 0 ? (
          <p className="cart-warn">
            {unavailable.length === 1 ? copy.oosOne : copy.oosMany(unavailable.length)}
          </p>
        ) : null}
        {coto && cotoGate && cotoGate !== 'pay' ? (
          <p className="cart-warn" data-testid="cart-coto-gate" data-gate={cotoGate} role="status" aria-live="polite">
            {gates[cotoGate]}
          </p>
        ) : null}
        <div className="cart-actions">
          {onPay && !coto ? (
            <button type="button" className="btn btn-pay" onClick={() => onPay(cart)}>
              {copy.payCta}
            </button>
          ) : null}
          {onPay && coto && cotoGate === 'pay' ? (
            <button
              type="button"
              className="btn btn-pay"
              data-testid="cart-coto-pay"
              style={{ minHeight: 44, minWidth: 44 }}
              onClick={() => onPay(cart)}
            >
              {copy.payCta}
            </button>
          ) : null}
          {handoffUrl ? (
            <a className="btn btn-ghost" href={handoffUrl} target="_blank" rel="noopener noreferrer">
              {copy.openAt(store)}
            </a>
          ) : null}
        </div>
      </footer>
    </section>
  );
}
