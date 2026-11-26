'use client';

import type { Block } from '../lib/chat-state';
import { feeCentavosOf } from '../lib/checkout/compare-fee.ts';
import { pesos } from '../lib/orders-copy.ts';
import type { SearchCompareItem } from '../lib/protocol.ts';
import { RETAILER_NAMES } from '../lib/retailers.ts';
import type { Chain } from '../lib/retailer-choice.ts';
import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';
import { ProductCard } from './ProductGrid';

function priced(items: SearchCompareItem[]): SearchCompareItem[] {
  return items.filter((item) => item.available && item.shelfCentavos > 0);
}

/**
 * Both chains for one query, before a cart exists.
 * Prices come from the event. A side with no positive price has no rows and no button.
 */
export function SearchCompareCard({
  block,
  chains,
  showChoose,
  showBuild,
  buildDisabled,
  onChoose,
  onBuild,
}: {
  block: Extract<Block, { kind: 'search_compare' }>;
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
  const pending = block.status === 'pending';
  return (
    <section className="search-compare" data-testid="search-compare" aria-label={block.query}>
      {chains.map((chain) => {
        const items = priced(chain === 'dia' ? block.dia : block.coto);
        // While both chains are still loading, Día has no rows yet. The Coto
        // note is the pending line; an empty Día heading would sit above it.
        if (pending && items.length === 0 && chain === 'dia' && chains.includes('coto')) return null;
        const store = RETAILER_NAMES[chain];
        return (
          <section key={chain} className="search-compare-section" aria-label={store}>
            <h3 className="search-compare-store">{store}</h3>
            <ChainNote chain={chain} block={block} />
            {items.length > 0 ? (
              <ul className="grid">
                {items.map((item) => (
                  <ProductCard
                    key={item.id}
                    name={item.name}
                    brand={item.brand}
                    imageUrl={item.imageUrl}
                    imageAlt={item.name}
                    price={pesos(item.shelfCentavos, lang)}
                    unit={
                      item.unitMultiplier && item.measurementUnit
                        ? `${item.unitMultiplier} ${item.measurementUnit}`
                        : undefined
                    }
                  />
                ))}
              </ul>
            ) : null}
            {items.length > 0 ? (
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
    </section>
  );
}

function ChainNote({
  chain,
  block,
}: {
  chain: Chain;
  block: Extract<Block, { kind: 'search_compare' }>;
}) {
  const copy = uiCopy(useLang()).searchCompare;
  if (block.status === 'pending') {
    return chain === 'coto' ? (
      <p className="search-compare-note" role="status">
        {copy.pendingCoto}
      </p>
    ) : null;
  }
  if (chain === 'dia') {
    if (block.status === 'dia_error') return <p className="search-compare-note">{copy.diaError}</p>;
    if (priced(block.dia).length === 0) return <p className="search-compare-note">{copy.diaEmpty}</p>;
    return null;
  }
  if (block.status === 'coto_error') return <p className="search-compare-note">{copy.cotoError}</p>;
  if (block.status === 'coto_timed_out') return <p className="search-compare-note">{copy.cotoTimedOut}</p>;
  if (block.status === 'coto_empty' || priced(block.coto).length === 0) {
    return <p className="search-compare-note">{copy.cotoEmpty}</p>;
  }
  return null;
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
