'use client';

import type { Block } from '../lib/chat-state';
import { feeCentavosOf } from '../lib/checkout/compare-fee.ts';
import { cheapestAvailable } from '../lib/one-per-type.ts';
import { pesos } from '../lib/orders-copy.ts';
import type { SearchCompareItem } from '../lib/protocol.ts';
import { RETAILER_NAMES } from '../lib/retailers.ts';
import type { Chain } from '../lib/retailer-choice.ts';
import { uiCopy, type SearchCompareCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';
import { ProductCard } from './ProductGrid';

type SearchBlock = Extract<Block, { kind: 'search_compare' }>;

/**
 * The line on a type that has no product card.
 * An error status for this chain replaces the missing-type sentence.
 * While the type is still pending, Coto names the wait and Día stays quiet.
 */
function typeNote(
  chain: Chain,
  block: SearchBlock,
  picked: boolean,
  type: string,
  store: string,
  copy: SearchCompareCopy,
): string | null {
  if (block.status === 'pending') return chain === 'coto' ? copy.pendingCoto : null;
  if (picked) return null;
  if (chain === 'dia' && block.status === 'dia_error') return copy.diaError;
  if (chain === 'coto' && block.status === 'coto_error') return copy.cotoError;
  if (chain === 'coto' && block.status === 'coto_timed_out') return copy.cotoTimedOut;
  return copy.missingType(type, store);
}

function TypeSlot({
  typeLabel,
  note,
  announce,
  item,
  price,
  unit,
}: {
  typeLabel: string;
  note: string | null;
  announce?: boolean;
  item?: SearchCompareItem;
  price?: string;
  unit?: string;
}) {
  if (item && price) {
    return (
      <ProductCard
        kind={typeLabel}
        name={item.name}
        brand={item.brand}
        imageUrl={item.imageUrl}
        imageAlt=""
        price={price}
        unit={unit}
      />
    );
  }
  return (
    <li className="card card-empty">
      <div className="card-img">
        <span className="card-img-empty" aria-hidden="true">
          🛒
        </span>
      </div>
      <div className="card-body">
        <span className="card-kind">{typeLabel}</span>
        {note ? (
          <span className="card-name" role={announce ? 'status' : undefined}>
            {note}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/**
 * One row of types, Coto then Día, before a cart exists.
 * Each chain shows one card per type. The pick is `cheapestAvailable`,
 * so a stored block that still lists several rows draws one card too.
 * Prices come from the event. A chain with no pick has no buttons.
 */
export function SearchCompareCard({
  blocks,
  chains,
  showChoose,
  showBuild,
  buildDisabled,
  onChoose,
  onBuild,
}: {
  blocks: SearchBlock[];
  chains: Chain[];
  showChoose: boolean;
  showBuild: boolean;
  buildDisabled: boolean;
  onChoose: (retailer: Chain) => void;
  onBuild: (retailer: Chain) => void;
}) {
  const lang = useLang();
  const copy = uiCopy(lang);
  const search = copy.searchCompare;
  const label = blocks.map((block) => block.query).filter(Boolean).join(', ');
  const pending = blocks.some((block) => block.status === 'pending');
  return (
    <div className="search-compare" data-testid="search-compare" aria-label={label}>
      {chains.map((chain) => {
        const store = RETAILER_NAMES[chain];
        const slots = blocks.map((block) => {
          const items = chain === 'dia' ? block.dia : block.coto;
          return { block, item: cheapestAvailable(items) };
        });
        const anyPick = slots.some((slot) => slot.item);
        return (
          <section key={chain} className="search-compare-section" aria-label={store}>
            <h3 className="search-compare-store">{store}</h3>
            <ul className="grid">
              {slots.map(({ block, item }) => (
                <TypeSlot
                  key={block.id}
                  typeLabel={block.query}
                  note={typeNote(chain, block, Boolean(item), block.query, store, search)}
                  announce={block.status === 'pending' && chain === 'coto'}
                  item={item}
                  price={item ? pesos(item.shelfCentavos, lang) : undefined}
                  unit={
                    item?.unitMultiplier && item.measurementUnit
                      ? `${item.unitMultiplier} ${item.measurementUnit}`
                      : undefined
                  }
                />
              ))}
            </ul>
            {anyPick ? (
              <div className="search-compare-actions">
                {showChoose ? (
                  <button
                    type="button"
                    className="btn"
                    data-testid={`search-compare-choose-${chain}`}
                    disabled={pending}
                    onClick={() => onChoose(chain)}
                  >
                    {chain === 'dia' ? search.chooseDia : search.chooseCoto}
                  </button>
                ) : null}
                {showBuild ? (
                  <button
                    type="button"
                    className="btn"
                    data-testid={`search-compare-build-${chain}`}
                    disabled={buildDisabled}
                    aria-label={`${copy.chat.buildCart}, ${store}`}
                    onClick={() => onBuild(chain)}
                  >
                    {copy.chat.buildCart}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/**
 * The one comparison table, drawn after a cart exists.
 * The fee is `feeCentavosOf` of the server gap. The model does not write it.
 */
export function CompareCloseTable({
  block,
  query,
  postalCode,
  onChoose,
}: {
  block: Extract<Block, { kind: 'compare' }>;
  query?: string;
  postalCode?: string;
  onChoose: (retailer: Chain) => void;
}) {
  const lang = useLang();
  const search = uiCopy(lang).searchCompare;
  const compare = uiCopy(lang).compare;
  const title = query ? `${search.title} · ${query}` : search.title;
  const gap = block.gap;
  const fee =
    gap && Number.isSafeInteger(gap.gapCentavos) && gap.gapCentavos >= 0
      ? feeCentavosOf(Math.abs(gap.gapCentavos))
      : undefined;
  return (
    <section className="search-compare search-compare-close" data-testid="compare-close" aria-label={title}>
      <h3 className="search-compare-title">{title}</h3>
      {postalCode ? <p className="search-compare-sub">{search.subtitle(postalCode)}</p> : null}
      {block.status === 'pending' ? <p className="search-compare-note">{compare.pending}</p> : null}
      {block.status === 'timed_out' ? <p className="search-compare-note">{compare.timedOut}</p> : null}
      {block.status === 'degraded' ? <p className="search-compare-note">{compare.degraded}</p> : null}
      {gap && fee !== undefined ? (
        <>
          <dl className="compare-card-totals">
            <div className="compare-card-line">
              <dt>{RETAILER_NAMES.dia}</dt>
              <dd>{pesos(gap.diaSubtotalCentavos, lang)}</dd>
            </div>
            <div className="compare-card-line">
              <dt>{RETAILER_NAMES.coto}</dt>
              <dd>{pesos(gap.cotoSubtotalCentavos, lang)}</dd>
            </div>
          </dl>
          <p className="search-compare-fee">{search.gapFee(pesos(gap.gapCentavos, lang), pesos(fee, lang))}</p>
        </>
      ) : null}
      <div className="search-compare-actions">
        <button
          type="button"
          className="btn"
          data-testid="search-compare-choose-dia"
          onClick={() => onChoose('dia')}
        >
          {search.chooseDia}
        </button>
        <button
          type="button"
          className="btn"
          data-testid="search-compare-choose-coto"
          onClick={() => onChoose('coto')}
        >
          {search.chooseCoto}
        </button>
      </div>
    </section>
  );
}

export function MissingCard({
  block,
  onSubstitute,
  onDrop,
}: {
  block: Extract<Block, { kind: 'missing' }>;
  onSubstitute: () => void;
  onDrop: () => void;
}) {
  const copy = uiCopy(useLang());
  const store = RETAILER_NAMES[block.retailer] ?? block.retailer;
  return (
    <section className="missing-card" data-testid="missing-prompt" aria-label={copy.missing.prompt(block.item, store)}>
      <p>{copy.missing.prompt(block.item, store)}</p>
      <div className="missing-actions">
        <button type="button" className="btn" data-testid="missing-substitute" onClick={onSubstitute}>
          {copy.missing.substitute}
        </button>
        <button type="button" className="btn btn-ghost" data-testid="missing-drop" onClick={onDrop}>
          {copy.missing.drop}
        </button>
      </div>
    </section>
  );
}
