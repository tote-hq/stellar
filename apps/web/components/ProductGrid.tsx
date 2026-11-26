'use client';

import { useEffect, useRef, useState } from 'react';

import type { Product } from '@changuito/mcp/types';

import type { CardAddOutcome, CardAddReason } from '../lib/chat-state';
import { cotoImageUrl } from '../lib/one-per-type.ts';
import { RETAILER_NAMES } from '../lib/retailers.ts';
import { uiCopy, type CardAddCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';

export type { CardAddOutcome };
export type CardAddResult = CardAddOutcome;

function reasonLine(copy: CardAddCopy, reason: CardAddReason | undefined): string | null {
  if (reason === 'busy') return copy.busy;
  if (reason === 'network') return copy.network;
  return null;
}

/**
 * One product card. The grid and the search-compare sections share this markup.
 * The price string is already formatted by the caller from server data.
 * With `onAdd`, the whole card is the button. Without it, the card is a list item.
 */
export function ProductCard({
  name,
  brand,
  imageUrl,
  imageAlt,
  price,
  wasPrice,
  unit,
  unavailable,
  kind,
  id,
  onAdd,
  disabled,
  store,
  matchLabel,
  onResult,
}: {
  name: string;
  brand?: string;
  imageUrl?: string;
  /** Empty when the photo is decorative, the product name when it is the content. */
  imageAlt: string;
  price: string;
  wasPrice?: string;
  unit?: string;
  unavailable?: boolean;
  /** The type word, shown above the product name on a search card. */
  kind?: string;
  id?: string;
  onAdd?: () => Promise<CardAddOutcome>;
  disabled?: boolean;
  /** Store name in the accessible name. Absent on a card that is not a button. */
  store?: string;
  matchLabel?: string;
  onResult?: (result: CardAddOutcome) => void;
}) {
  const lang = useLang();
  const copy = uiCopy(lang).grid;
  const addCopy = uiCopy(lang).cardAdd;
  const src = cotoImageUrl(id, imageUrl);
  const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<'idle' | 'adding' | 'added' | 'error'>('idle');
  const [reason, setReason] = useState<CardAddReason | undefined>(undefined);
  const cardRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const showImage = src !== undefined && failedSrc !== src;
  useEffect(() => {
    if (phase === 'error') retryRef.current?.focus();
    if (phase === 'added') cardRef.current?.focus();
  }, [phase]);
  const runAdd = () => {
    if (!onAdd || phase === 'adding' || disabled) return;
    setPhase('adding');
    void onAdd().then((outcome) => {
      if (outcome.result === 'added') {
        setReason(undefined);
        setPhase('added');
      } else if (outcome.result === 'failed') {
        setReason(outcome.reason);
        setPhase(outcome.reason === 'switch_required' ? 'idle' : 'error');
      } else {
        setReason(undefined);
        setPhase('idle');
      }
      onResult?.(outcome);
    });
  };
  const body = (
    <>
      <div className="card-img">
        {showImage ? (
          // Plain <img>: these are the supermarket's own CDN URLs, which
          // change without notice. next/image would need every host
          // whitelisted up front, and a missed one is a broken page.
          // A load, 404 or CSP failure swaps to the empty square. Both
          // states sit in this box, so the card does not jump.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={imageAlt} loading="lazy" onError={() => setFailedSrc(src)} />
        ) : (
          <span className="card-img-empty" aria-hidden="true">🛒</span>
        )}
      </div>
      <div className="card-body">
        {kind ? <span className="card-kind">{kind}</span> : null}
        {brand ? <span className="card-brand">{brand}</span> : null}
        <span className="card-name">{name}</span>
        {matchLabel ? <span className="card-match">{matchLabel}</span> : null}
        <span className="card-price">
          {price}
          {wasPrice ? <s className="card-was">{wasPrice}</s> : null}
        </span>
        {unit ? <span className="card-unit">{unit}</span> : null}
        {unavailable ? <span className="card-oos">{copy.outOfStock}</span> : null}
        {phase === 'adding' ? <span className="card-add-state">{addCopy.adding}</span> : null}
        {phase === 'added' ? <span className="card-add-state">{addCopy.added}</span> : null}
        {phase === 'error' ? (
          <div className="card-add-error" role="status" aria-live="polite">
            <span className="card-add-error-text">
              <span className="card-add-icon" aria-hidden="true">!</span>
              {addCopy.failed}
              {reasonLine(addCopy, reason) ? <span className="card-add-reason">{reasonLine(addCopy, reason)}</span> : null}
            </span>
            <button
              ref={retryRef}
              type="button"
              className="card-add-retry"
              data-testid="card-add-retry"
              aria-label={`${addCopy.retry}, ${name}`}
              onClick={runAdd}
            >
              {addCopy.retry}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
  if (!onAdd) {
    return (
      <li className="card" data-testid="product-card">
        {body}
      </li>
    );
  }
  return (
    <li className="card-slot">
      {phase === 'error' ? (
        <div className="card" data-testid="product-card" tabIndex={-1}>
          {body}
        </div>
      ) : (
        <button
          ref={cardRef}
          type="button"
          className="card"
          data-testid="product-card"
          aria-label={store ? addCopy.label(name, store) : name}
          aria-disabled={phase === 'adding' || disabled ? true : undefined}
          disabled={disabled}
          onClick={runAdd}
        >
          {body}
        </button>
      )}
    </li>
  );
}

/**
 * What the model chose to show, not everything it searched.
 *
 * Every number here comes from `structuredContent`, never from parsing the
 * text the model reads. That text is padded columns and AR-locale money; a
 * change in its spacing would put a wrong price on a card.
 */
export function ProductGrid({
  items,
  note,
  onAdd,
  disabled,
}: {
  items: Product[];
  note?: string;
  onAdd?: (id: string) => Promise<CardAddOutcome>;
  disabled?: boolean;
}) {
  const lang = useLang();
  const copy = uiCopy(lang).grid;
  const addCopy = uiCopy(lang).cardAdd;
  const [live, setLive] = useState('');
  if (items.length === 0) return null;
  const store = RETAILER_NAMES.dia;
  return (
    <section className="grid-wrap" aria-label={copy.aria}>
      {note ? <p className="grid-note">{note}</p> : null}
      <ul className="grid">
        {items.map((p) => (
          <ProductCard
            key={`${p.skuId}-${p.sellerId}`}
            id={p.skuId}
            name={p.name}
            brand={p.brand}
            imageUrl={p.imageUrl}
            imageAlt=""
            price={p.price.display}
            wasPrice={p.listPrice && p.listPrice.centavos > p.price.centavos ? p.listPrice.display : undefined}
            unit={p.unitMultiplier && p.measurementUnit ? `${p.unitMultiplier} ${p.measurementUnit}` : undefined}
            unavailable={!p.available}
            store={onAdd ? store : undefined}
            disabled={disabled}
            onAdd={onAdd ? () => onAdd(p.skuId) : undefined}
            onResult={(outcome) => {
              if (outcome.result === 'added') setLive(addCopy.added);
              else if (outcome.result === 'failed') setLive(addCopy.failed);
            }}
          />
        ))}
      </ul>
      {onAdd ? (
        <div className="sr-only" aria-live="polite" data-testid="card-add-status">
          {live}
        </div>
      ) : null}
    </section>
  );
}
