'use client';

import { useState } from 'react';

import type { Cart } from '@changuito/mcp/types';

import { COTO_REAL_KIND } from '../lib/checkout/coto-real.ts';
import type { Lang } from '../lib/lang.ts';
import { useLang } from './LangProvider';

/**
 * S1 for a real Coto checkout.
 * The lock button is disabled: this step does not open an escrow or a job.
 * No iframe, no card number, no Día login.
 */
export function CotoRealModal({
  cart,
  sessionId,
  postalCode,
  onClose,
}: {
  cart: Cart;
  sessionId: string;
  postalCode?: string;
  onClose: () => void;
}) {
  const lang = useLang();
  const copy = modalCopy(lang);
  const [postal, setPostal] = useState(postalCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteView | null>(null);

  async function usePostal() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cart,
          checkoutKind: COTO_REAL_KIND,
          postalCode: postal,
          sessionId,
        }),
      });
      const body = (await res.json()) as QuoteView & { error?: string };
      if (!res.ok) {
        setQuote(null);
        setError(body.error ?? copy.failed);
        return;
      }
      setQuote(body);
    } catch {
      setQuote(null);
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="coto-real-title"
        data-testid="coto-real-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="coto-real-title">{copy.title}</h2>
        <p>{copy.disclosure}</p>
        <label htmlFor="coto-real-postal">{copy.postal}</label>
        <input
          id="coto-real-postal"
          data-testid="coto-real-postal"
          value={postal}
          onChange={(event) => setPostal(event.target.value)}
          autoComplete="postal-code"
          inputMode="text"
        />
        <button
          type="button"
          className="btn"
          data-testid="coto-real-use-postal"
          style={{ minHeight: 44 }}
          disabled={busy || postal.trim().length === 0}
          onClick={() => void usePostal()}
        >
          {copy.usePostal}
        </button>
        {error ? (
          <p role="alert" data-testid="coto-real-error">
            {error}
          </p>
        ) : null}
        {quote ? (
          <ul data-testid="coto-real-lines">
            <li>
              {copy.cotoTotal} {peso(quote.cotoTicketCentavos)}
            </li>
            <li>
              {copy.diaTotal} {peso(quote.diaMatchedCentavos)}
            </li>
            <li>
              {copy.gap} {peso(quote.gapCentavos)}
            </li>
            <li>
              {copy.fee} {peso(quote.feeCentavos)}
            </li>
            <li>
              {copy.lock} {quote.amountDisplay}
            </li>
          </ul>
        ) : null}
        <button
          type="button"
          className="btn btn-pay"
          data-testid="coto-real-lock"
          style={{ minHeight: 44 }}
          disabled
        >
          {quote ? copy.lockCta(quote.amountDisplay) : copy.lockCta('')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {copy.close}
        </button>
      </div>
    </div>
  );
}

interface QuoteView {
  cotoTicketCentavos: number;
  diaMatchedCentavos: number;
  gapCentavos: number;
  feeCentavos: number;
  amountDisplay: string;
}

function peso(centavos: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(centavos / 100);
}

function modalCopy(lang: Lang) {
  if (lang === 'en') {
    return {
      title: 'Pay at Coto',
      disclosure:
        'You pay Changuito in testnet USDC for the Coto total plus the fee. Coto is charged on the operating card. You do not open the supermarket.',
      postal: 'Postal code',
      usePostal: 'Use this postal code',
      cotoTotal: 'Coto total',
      diaTotal: 'Matching Día subtotal',
      gap: 'Difference',
      fee: 'Fee 20%',
      lock: 'Held (testnet USDC)',
      lockCta: (amount: string) => (amount ? `Lock ${amount} and prepare the order` : 'Lock USDC and prepare the order'),
      close: 'Close',
      failed: 'We could not quote that basket.',
    };
  }
  return {
    title: 'Pagar en Coto',
    disclosure:
      'Pagás a Changuito en USDC de testnet el total de Coto más la comisión. Coto se cobra con la tarjeta operativa. No abrís el súper.',
    postal: 'Código postal',
    usePostal: 'Usar este CP',
    cotoTotal: 'Total Coto',
    diaTotal: 'Total Día (líneas que matchean)',
    gap: 'Diferencia',
    fee: 'Comisión 20%',
    lock: 'Se bloquean (USDC testnet)',
    lockCta: (amount: string) => (amount ? `Bloquear ${amount} y preparar el pedido` : 'Bloquear USDC y preparar el pedido'),
    close: 'Cerrar',
    failed: 'No pudimos cotizar ese changuito.',
  };
}
