'use client';

import { useEffect, useState } from 'react';

import type { Cart } from '@changuito/mcp/types';

import { COTO_REAL_KIND } from '../lib/checkout/coto-real.ts';
import { OpenConfirmationPending, submitOpen } from '../lib/checkout/open-submission.ts';
import { fetchAs } from '../lib/fetch-as.ts';
import type { Lang } from '../lib/lang.ts';
import { useLang } from './LangProvider';
import { useWallet } from '../lib/use-wallet.ts';

/**
 * Real Coto checkout. The lock opens testnet escrow, then a sandbox job.
 * No iframe, no card number, no Día login, no viewer link.
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
  const wallet = useWallet();
  const copy = modalCopy(lang);
  const [postal, setPostal] = useState(postalCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId || !wallet.address) return;
    let stop = false;
    const pull = async () => {
      try {
        const res = await fetchAs(
          { address: wallet.address, sign: wallet.accessToken },
          `/api/checkout/status?orderId=${orderId}`,
        );
        const body = (await res.json()) as StatusView;
        if (stop || !res.ok) return;
        if (body.note) setNote(body.note);
        if (body.error) setError(body.error);
        if (body.stage === 'done') {
          const done = modalCopy(lang).done(body.storeOrderId ?? '');
          setNote(done);
          setError(null);
        }
        if (body.stage === 'refunded') setNote(null);
      } catch {
        if (!stop) setError(modalCopy(lang).failed);
      }
    };
    void pull();
    const timer = setInterval(() => void pull(), 3000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [lang, orderId, wallet.accessToken, wallet.address]);

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

  async function lock() {
    if (!quote?.orderId || !wallet.address) {
      setError(copy.signIn);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const tx = await wallet.openEscrow({
        orderId: quote.orderId,
        amount: quote.amount,
        basketHash: quote.basketHash,
        timeoutSecs: quote.timeoutSecs,
      });
      const opened = await submitOpen(
        (url, init) => fetchAs({ address: wallet.address, sign: wallet.accessToken }, url, init),
        { orderId: quote.orderId, tx },
        copy.failed,
      );
      const res = await fetchAs({ address: wallet.address, sign: wallet.accessToken }, '/api/checkout/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: quote.orderId, openSig: opened.openSig }),
      });
      const body = (await res.json()) as { error?: string; note?: string | null };
      if (!res.ok) {
        setError(body.error ?? copy.failed);
        return;
      }
      setOrderId(quote.orderId);
      setNote(body.note ?? copy.working);
    } catch (err) {
      setError(err instanceof OpenConfirmationPending ? copy.pending : err instanceof Error && err.message ? err.message : copy.failed);
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
        {note ? (
          <p data-testid="coto-real-status">{note}</p>
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
          disabled={busy || !quote?.orderId}
          onClick={() => void lock()}
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
  orderId: string;
  amount: string;
  basketHash: string;
  timeoutSecs: number;
  cotoTicketCentavos: number;
  diaMatchedCentavos: number;
  gapCentavos: number;
  feeCentavos: number;
  amountDisplay: string;
}

interface StatusView {
  stage?: string;
  note?: string | null;
  error?: string | null;
  storeOrderId?: string | null;
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
      signIn: 'Sign in to pay.',
      pending: 'We received the wallet approval and we are still confirming the lock.',
      working: 'We are placing the Coto order.',
      done: (id: string) => (id ? `Coto order ${id} is placed.` : 'The Coto order is placed.'),
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
    signIn: 'Iniciá sesión para pagar.',
    pending: 'Recibimos la aprobación de tu billetera y todavía estamos confirmando el bloqueo.',
    working: 'Estamos haciendo el pedido en Coto.',
    done: (id: string) => (id ? `Pedido de Coto ${id} listo.` : 'El pedido de Coto quedó listo.'),
  };
}
