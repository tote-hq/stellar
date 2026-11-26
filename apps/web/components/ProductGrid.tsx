'use client';

import type { Product } from '@changuito/mcp/types';

import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';

/**
 * One product card. The grid and the search-compare sections share this markup.
 * The price string is already formatted by the caller from server data.
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
}) {
  const copy = uiCopy(useLang()).grid;
  return (
    <li className="card">
      <div className="card-img">
        {imageUrl ? (
          // Plain <img>: these are the supermarket's own CDN URLs, which
          // change without notice. next/image would need every host
          // whitelisted up front, and a missed one is a broken page.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={imageAlt} loading="lazy" />
        ) : (
          <span className="card-img-empty" aria-hidden="true">🛒</span>
        )}
      </div>
      <div className="card-body">
        {brand ? <span className="card-brand">{brand}</span> : null}
        <span className="card-name">{name}</span>
        <span className="card-price">
          {price}
          {wasPrice ? <s className="card-was">{wasPrice}</s> : null}
        </span>
        {unit ? <span className="card-unit">{unit}</span> : null}
        {unavailable ? <span className="card-oos">{copy.outOfStock}</span> : null}
      </div>
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
export function ProductGrid({ items, note }: { items: Product[]; note?: string }) {
  const copy = uiCopy(useLang()).grid;
  if (items.length === 0) return null;
  return (
    <section className="grid-wrap" aria-label={copy.aria}>
      {note ? <p className="grid-note">{note}</p> : null}
      <ul className="grid">
        {items.map((p) => (
          <ProductCard
            key={`${p.skuId}-${p.sellerId}`}
            name={p.name}
            brand={p.brand}
            imageUrl={p.imageUrl}
            imageAlt=""
            price={p.price.display}
            wasPrice={p.listPrice && p.listPrice.centavos > p.price.centavos ? p.listPrice.display : undefined}
            unit={p.unitMultiplier && p.measurementUnit ? `${p.unitMultiplier} ${p.measurementUnit}` : undefined}
            unavailable={!p.available}
          />
        ))}
      </ul>
    </section>
  );
}
