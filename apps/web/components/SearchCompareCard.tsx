'use client';

import type { Block } from '../lib/chat-state';
import { pesos } from '../lib/orders-copy.ts';
import { RETAILER_NAMES } from '../lib/retailers.ts';
import type { Chain } from '../lib/retailer-choice.ts';
import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';

/**
 * Both chains for one query, before a cart exists.
 * Prices come from the event. A side with no positive price has no rows and no button.
 */
export function SearchCompareCard({
  block,
  onChoose,
}: {
  block: Extract<Block, { kind: 'search_compare' }>;
  onChoose: (retailer: Chain) => void;
}) {
  const lang = useLang();
  const copy = uiCopy(lang).searchCompare;
  const dia = block.dia.filter((item) => item.available && item.shelfCentavos > 0);
  const coto = block.coto.filter((item) => item.available && item.shelfCentavos > 0);
  const showFee = block.gapCentavos !== undefined && block.feeCentavos !== undefined;
  return (
    <section className="search-compare" data-testid="search-compare" aria-label={copy.title}>
      <h3 className="search-compare-title">
        {copy.title} · {block.query}
      </h3>
      {block.postalCode ? <p className="search-compare-sub">{copy.subtitle(block.postalCode)}</p> : null}
      {block.status === 'pending' ? (
        <p className="search-compare-note" role="status">
          {copy.pendingCoto}
        </p>
      ) : null}
      {block.status === 'dia_error' ? <p className="search-compare-note">{copy.diaError}</p> : null}
      {block.status !== 'pending' && block.status !== 'dia_error' && dia.length === 0 ? (
        <p className="search-compare-note">{copy.diaEmpty}</p>
      ) : null}
      {block.status === 'coto_empty' || (block.status === 'ok' && coto.length === 0) ? (
        <p className="search-compare-note">{copy.cotoEmpty}</p>
      ) : null}
      {block.status === 'coto_error' ? <p className="search-compare-note">{copy.cotoError}</p> : null}
      {block.status === 'coto_timed_out' ? <p className="search-compare-note">{copy.cotoTimedOut}</p> : null}
      {showFee ? (
        <p className="search-compare-fee">{copy.gapFee(pesos(block.gapCentavos!, lang), pesos(block.feeCentavos!, lang))}</p>
      ) : null}
      {block.status !== 'pending' ? (
        <div className="search-compare-cols">
          <div className="search-compare-col">
            <h4 className="search-compare-store">{RETAILER_NAMES.dia}</h4>
            <ul className="search-compare-list">
              {dia.map((item) => (
                <li key={item.id} className="search-compare-row">
                  <span className="search-compare-name">{item.name}</span>
                  <span className="search-compare-price">{pesos(item.shelfCentavos, lang)}</span>
                </li>
              ))}
            </ul>
            {dia.length > 0 ? (
              <button
                type="button"
                className="btn"
                data-testid="search-compare-choose-dia"
                onClick={() => onChoose('dia')}
              >
                {copy.chooseDia}
              </button>
            ) : null}
          </div>
          <div className="search-compare-col">
            <h4 className="search-compare-store">{RETAILER_NAMES.coto}</h4>
            <ul className="search-compare-list">
              {coto.map((item) => (
                <li key={item.id} className="search-compare-row">
                  <span className="search-compare-name">{item.name}</span>
                  <span className="search-compare-price">{pesos(item.shelfCentavos, lang)}</span>
                </li>
              ))}
            </ul>
            {coto.length > 0 ? (
              <button
                type="button"
                className="btn"
                data-testid="search-compare-choose-coto"
                onClick={() => onChoose('coto')}
              >
                {copy.chooseCoto}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
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
