'use client';

import { pesos } from '../lib/orders-copy.ts';
import type { Block } from '../lib/chat-state.ts';
import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';

/**
 * Día against the Coto catalog, drawn by the server after the cart link.
 * Prices come from that lookup. A missing price is left off the row.
 */
export function ComparisonCard({ block }: { block: Extract<Block, { kind: 'compare' }> }) {
  const lang = useLang();
  const copy = uiCopy(lang).compare;
  const titleId = `${block.id}-title`;
  return (
    <section className="compare-card" data-testid="compare-card" aria-labelledby={titleId}>
      <h3 id={titleId} className="compare-card-title">{copy.title}</h3>
      {block.status === 'pending' ? <p className="compare-card-note">{copy.pending}</p> : (
        <p className="compare-card-note">{copy.matched(block.matched, block.lines)}</p>
      )}
      {block.gap ? (
        <dl className="compare-card-totals">
          <div className="compare-card-line">
            <dt>Día</dt>
            <dd>{pesos(block.gap.diaSubtotalCentavos, lang)}</dd>
          </div>
          <div className="compare-card-line">
            <dt>Coto</dt>
            <dd>{pesos(block.gap.cotoSubtotalCentavos, lang)}</dd>
          </div>
          <div className="compare-card-line">
            <dt>{copy.gapLabel}</dt>
            <dd>{pesos(block.gap.gapCentavos, lang)}</dd>
          </div>
        </dl>
      ) : null}
      {block.status === 'degraded' ? <p className="compare-card-note">{copy.degraded}</p> : null}
      {block.status === 'timed_out' ? <p className="compare-card-note">{copy.timedOut}</p> : null}
      {block.rows.length > 0 ? (
        <ul className="compare-card-rows">
          {block.rows.map((row) => {
            const price = row.coto && row.coto.lineCentavos > 0 ? pesos(row.coto.lineCentavos, lang) : null;
            const href = row.coto?.url && /^https?:\/\//i.test(row.coto.url) ? row.coto.url : undefined;
            const label = row.coto?.name ?? row.name;
            return (
              <li key={row.skuId} className="compare-card-row">
                <span className="compare-card-name">{row.name}</span>
                {price ? <span className="compare-card-price">{price}</span> : null}
                {href ? (
                  <a
                    className="btn btn-ghost"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${copy.cotoCta}: ${label}`}
                  >
                    {copy.cotoCta}
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {block.handoffUrl ? (
        <div className="compare-card-actions">
          <a className="btn btn-ghost" href={block.handoffUrl} target="_blank" rel="noopener noreferrer">
            {copy.diaCta}
          </a>
        </div>
      ) : null}
    </section>
  );
}
