'use client';

import { useEffect, useState } from 'react';

import type { Cart } from '@changuito/mcp/types';

import { COTO_REAL_KIND, HOME_MINIMUM_CENTAVOS, HOME_MINIMUM_COPY } from '../lib/checkout/coto-real.ts';
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
  city: cityProp,
  onClose,
}: {
  cart: Cart;
  sessionId: string;
  postalCode?: string;
  city?: string;
  onClose: () => void;
}) {
  const lang = useLang();
  const wallet = useWallet();
  const copy = modalCopy(lang);
  const [postal, setPostal] = useState(postalCode ?? '');
  const [city, setCity] = useState(cityProp ?? '');
  const [fulfillment, setFulfillment] = useState<'home' | 'pickup'>('home');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const dropQuote = () => setQuote(null);
  const [note, setNote] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<StatusView['prompt']>(null);
  const [promptAnswer, setPromptAnswer] = useState('');

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
        if (body.prompt) setPrompt(body.prompt);
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
          city,
          fulfillment,
          street,
          number,
          complement,
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
        <p>{copy.never}</p>
        <fieldset data-testid="checkout-fulfillment">
          <legend>{copy.mode}</legend>
          <label>
            <input
              type="radio"
              name="fulfillment"
              value="home"
              data-testid="checkout-fulfillment-home"
              checked={fulfillment === 'home'}
              onChange={() => {
                setFulfillment('home');
                dropQuote();
              }}
            />
            {copy.home}
          </label>
          <label>
            <input
              type="radio"
              name="fulfillment"
              value="pickup"
              data-testid="checkout-fulfillment-pickup"
              checked={fulfillment === 'pickup'}
              onChange={() => {
                setFulfillment('pickup');
                dropQuote();
              }}
            />
            {copy.pickup}
          </label>
        </fieldset>
        {fulfillment === 'home' ? (
          <div data-testid="checkout-address">
            <label htmlFor="coto-real-street">{copy.street}</label>
            <input id="coto-real-street" value={street} onChange={(event) => { setStreet(event.target.value); dropQuote(); }} autoComplete="address-line1" style={{ minHeight: 44 }} />
            <label htmlFor="coto-real-number">{copy.number}</label>
            <input id="coto-real-number" value={number} onChange={(event) => { setNumber(event.target.value); dropQuote(); }} style={{ minHeight: 44 }} />
            <label htmlFor="coto-real-complement">{copy.complement}</label>
            <input id="coto-real-complement" value={complement} onChange={(event) => { setComplement(event.target.value); dropQuote(); }} style={{ minHeight: 44 }} />
            <label htmlFor="coto-real-city">{copy.city}</label>
            <input id="coto-real-city" value={city} onChange={(event) => { setCity(event.target.value); dropQuote(); }} autoComplete="address-level2" style={{ minHeight: 44 }} />
          </div>
        ) : null}
        <label htmlFor="coto-real-postal">{copy.postal}</label>
        <input
          id="coto-real-postal"
          data-testid="coto-real-postal"
          value={postal}
          onChange={(event) => { setPostal(event.target.value); dropQuote(); }}
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
        {error === HOME_MINIMUM_COPY ? (
          <p role="alert" data-testid="checkout-home-minimum">
            {HOME_MINIMUM_COPY}
          </p>
        ) : error ? (
          <p role="alert" data-testid="coto-real-error">
            {error}
          </p>
        ) : null}
        {prompt ? (
          <form
            data-testid="checkout-prompt"
            onSubmit={(event) => {
              event.preventDefault();
              if (!orderId || !promptAnswer.trim()) return;
              void fetchAs({ address: wallet.address, sign: wallet.accessToken }, '/api/checkout/prompt', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ orderId, answer: promptAnswer.trim() }),
              }).then(() => setPrompt(null));
            }}
          >
            <p>{prompt.label}</p>
            {prompt.options && prompt.options.length > 0 ? (
              prompt.options.map((option) => (
                <label key={option.value}>
                  <input
                    type="radio"
                    name="prompt"
                    value={option.value}
                    data-testid="checkout-prompt-input"
                    onChange={() => setPromptAnswer(option.value)}
                  />
                  {option.label}
                  {option.suggested ? ' · sugerida' : ''}
                </label>
              ))
            ) : (
              <input
                data-testid="checkout-prompt-input"
                value={promptAnswer}
                onChange={(event) => setPromptAnswer(event.target.value)}
                style={{ minHeight: 44 }}
              />
            )}
            <button type="submit" data-testid="checkout-prompt-submit" style={{ minHeight: 44, minWidth: 44 }}>
              Enviar
            </button>
          </form>
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
            <li data-testid="checkout-shipping-provision">
              {copy.provision} {peso(quote.shippingProvisionCentavos ?? (fulfillment === 'home' ? 400000 : 0))}
              <span> {copy.provisionHelp}</span>
            </li>
          </ul>
        ) : null}
        <button
          type="button"
          className="btn btn-pay"
          data-testid="coto-real-lock"
          style={{ minHeight: 44 }}
          disabled={
            busy ||
            !quote?.orderId ||
            !city.trim() ||
            (fulfillment === 'home' &&
              (!street.trim() || !number.trim() || (quote?.cotoTicketCentavos ?? 0) < HOME_MINIMUM_CENTAVOS))
          }
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
  shippingProvisionCentavos?: number;
  amountDisplay: string;
}

interface StatusView {
  stage?: string;
  note?: string | null;
  error?: string | null;
  storeOrderId?: string | null;
  prompt?: {
    label: string;
    fieldRef?: string | null;
    options?: { label: string; value: string; suggested?: boolean }[] | null;
  } | null;
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
      never: 'Changuito never asks for your password or your card.',
      mode: 'How do you want it?',
      home: 'Home delivery',
      pickup: 'Store pickup',
      street: 'Street',
      number: 'Number',
      complement: 'Floor / apartment',
      city: 'City',
      provision: 'Shipping (average)',
      provisionHelp: 'An average reserved for shipping. Not this trip’s tariff.',
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
    never: 'Changuito nunca te pide la clave ni la tarjeta.',
    mode: '¿Cómo lo querés?',
    home: 'Envío a domicilio',
    pickup: 'Retiro en tienda',
    street: 'Calle',
    number: 'Número',
    complement: 'Piso / depto',
    city: 'Ciudad',
    provision: 'Envío (promedio)',
    provisionHelp: 'Es un promedio para reservar el envío. No es la tarifa de esta corrida.',
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
