'use client';

import { useEffect, useId, useRef, useState } from 'react';

import {
  LANG_KEY,
  THEME_KEY,
  format,
  formatInt,
  formatUpdatedAt,
  messages,
  parseLang,
  parseTheme,
  phraseLine,
  type Lang,
  type ThemeName,
} from '../../lib/stats/i18n';
import {
  HOME_URL,
  contractHref,
  contractId,
  shortId,
  txHref,
  type StatsSnapshot,
} from '../../lib/stats/metrics';
import {
  barRatio,
  chartBars,
  engineeringMeters,
  engineeringTests,
  kpiTitleKey,
  kpis,
  meterPeak,
  networkMeters,
  networkNameKey,
  plotTop,
  pointsFor,
  pointsInRange,
  recentTxs,
  seriesPeak,
  sumSeries,
  visibleChains,
  type Chain,
  type ChartMode,
  type Meter,
  type NetworkFilter,
  type RangeId,
  type SeriesKind,
} from '../../lib/stats/view';
import styles from './stats.module.css';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode still keeps the choice for this view.
  }
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  testId: string;
}) {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  return (
    <div role="radiogroup" aria-label={label} className={styles.segment} data-testid={testId}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-testid={`${testId}-${option.value}`}
            ref={(node) => {
              refs.current[option.value] = node;
            }}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              const index = options.findIndex((item) => item.value === value);
              let next = index;
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
              else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
              else return;
              event.preventDefault();
              const chosen = options[next];
              if (!chosen) return;
              onChange(chosen.value);
              refs.current[chosen.value]?.focus();
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ThemeIcon({ theme }: { theme: ThemeName }) {
  if (theme === 'dark') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
        <path
          d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function chainLabel(chain: Chain, t: ReturnType<typeof messages>): string {
  if (chain === 'solana') return t.legendSolana;
  if (chain === 'stellar') return t.legendStellar;
  return t.legendSeeker;
}

function ChartCard({
  kind,
  title,
  range,
  mode,
  filter,
  lang,
  snapshot,
}: {
  kind: SeriesKind;
  title: string;
  range: RangeId;
  mode: ChartMode;
  filter: NetworkFilter;
  lang: Lang;
  snapshot: StatsSnapshot;
}) {
  const t = messages(lang);
  const titleId = useId();
  const bars = chartBars(kind, range, filter, mode, snapshot);
  const chains = visibleChains(filter);
  const top = plotTop(seriesPeak(bars, filter));
  const total = sumSeries(pointsInRange(pointsFor(kind, 'day', snapshot), range, snapshot.asOf), filter);
  const [active, setActive] = useState<number | null>(null);
  const ticks = [top, Math.round(top / 2), 0];

  function tipFor(index: number): string {
    const bar = bars[index];
    if (!bar) return '';
    if (chains.length === 2) {
      return format(t.colTip, {
        label: bar.label,
        leftName: t.legendSolana,
        left: formatInt(bar.solana, lang),
        rightName: t.legendStellar,
        right: formatInt(bar.stellar, lang),
      });
    }
    const chain = chains[0] ?? 'solana';
    return format(t.colTipOne, {
      label: bar.label,
      name: chainLabel(chain, t),
      count: formatInt(bar[chain], lang),
    });
  }

  return (
    <article className={styles.card} data-testid={`stats-chart-${kind}`} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.chartTitle}>
        {title}
      </h3>
      <p className={styles.chartTotal}>{formatInt(total, lang)}</p>
      {bars.length === 0 ? (
        <p className={styles.empty}>{t.emptyChart}</p>
      ) : (
        <div className={styles.plot}>
          <div className={styles.yAxis} aria-hidden="true">
            {ticks.map((tick, index) => (
              <span key={`${index}-${tick}`}>{formatInt(tick, lang)}</span>
            ))}
          </div>
          <div className={styles.canvas}>
            <div className={styles.grid} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className={styles.columns}>
              {bars.map((bar, index) => (
                <div className={styles.column} key={bar.label}>
                  <button
                    type="button"
                    className={styles.hit}
                    aria-label={tipFor(index)}
                    onMouseEnter={() => setActive(index)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive(null)}
                  >
                    {chains.map((chain) => (
                      <span
                        key={chain}
                        className={styles.bar}
                        style={{
                          height: `${barRatio(bar[chain], top) * 100}%`,
                          background: `var(--bar-${chain})`,
                          ['--bar-ink' as string]: `var(--bar-${chain}-ink)`,
                        }}
                      />
                    ))}
                  </button>
                  <span className={styles.xlabel}>{bar.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <ul className={styles.legend}>
        {chains.map((chain) => (
          <li key={chain}>
            <span
              className={styles.dot}
              style={{
                background: `var(--bar-${chain})`,
                ['--bar-ink' as string]: `var(--bar-${chain}-ink)`,
              }}
              aria-hidden="true"
            />
            {chainLabel(chain, t)}
          </li>
        ))}
      </ul>
      <p className={styles.readout}>{active === null ? '' : tipFor(active)}</p>
    </article>
  );
}

function MeterList({ rows, lang }: { rows: readonly Meter[]; lang: Lang }) {
  const peak = plotTop(meterPeak(rows));
  return (
    <div className={styles.meters}>
      {rows.map((row) => {
        const label = row.label ? phraseLine([row.label], lang) : (row.labelText ?? '');
        const detail = phraseLine([row.detail], lang);
        return (
          <div key={row.id} className={styles.meter}>
            <div className={styles.meterTop}>
              <span className={styles.meterLabel}>{label}</span>
              <span className={styles.meterDetail}>{detail}</span>
            </div>
            <div className={styles.track} aria-hidden="true">
              <div
                className={styles.fill}
                style={{
                  width: `${barRatio(row.value, peak) * 100}%`,
                  background: `var(--bar-${row.tone})`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StatsDashboard({ snapshot }: { snapshot: StatsSnapshot }) {
  const [lang, setLang] = useState<Lang>('en');
  const [theme, setTheme] = useState<ThemeName>('light');
  const [filter, setFilter] = useState<NetworkFilter>('all');
  const [range, setRange] = useState<RangeId>('all');
  const [panel, setPanel] = useState<'overview' | 'transactions'>('overview');
  const [mode, setMode] = useState<ChartMode>('daily');
  const t = messages(lang);

  useEffect(() => {
    setLang(parseLang(readStorage(LANG_KEY)));
    setTheme(parseTheme(readStorage(THEME_KEY)));
  }, []);

  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = lang === 'es' ? 'es' : 'en';
    return () => {
      document.documentElement.lang = previous;
    };
  }, [lang]);

  function chooseLang(next: Lang) {
    setLang(next);
    writeStorage(LANG_KEY, next);
  }

  function chooseTheme(next: ThemeName) {
    setTheme(next);
    writeStorage(THEME_KEY, next);
  }

  const cards = kpis(filter, snapshot);
  const txs = recentTxs(filter, snapshot);
  const states = Object.values(snapshot.sources);
  const freshness =
    snapshot.updatedAt === null || (snapshot.sources.solana !== 'live' && snapshot.sources.stellar !== 'live')
      ? t.snapshotNote
      : states.every((state) => state === 'live')
        ? t.liveNote
        : `${t.liveNote} ${t.partialNote}`;
  const rangeLabel =
    range === '7d' ? t.range7d : range === '30d' ? t.range30d : range === '90d' ? t.range90d : t.rangeAll;

  return (
    <div className={styles.shell} data-theme={theme} data-testid="stats-screen" lang={lang}>
      <a className={styles.skip} href="#metrics">
        {t.skip}
      </a>
      <header className={styles.header} data-testid="stats-header">
        <div className={styles.brand}>
          <a className={styles.brandLink} href={HOME_URL} data-testid="stats-brand">
            <img className={styles.logo} src="/brand/mascot-idle.png" alt="" width={397} height={583} />
            <span className={styles.wordmarkWrap} data-testid="stats-wordmark">
              <img className={styles.wordmark} src="/brand/wordmark.png" alt={t.brand} width={1024} height={170} />
            </span>
          </a>
          <span className={styles.badge}>{t.badge}</span>
        </div>
        <div className={styles.tools}>
          <Segmented
            label={t.networkLabel}
            value={filter}
            options={[
              { value: 'all', label: t.netAll },
              { value: 'stellar', label: t.netStellar },
              { value: 'solana', label: t.netSolana },
              { value: 'seeker', label: t.netSeeker },
            ]}
            onChange={setFilter}
            testId="stats-network"
          />
          <Segmented
            label={t.rangeLabel}
            value={range}
            options={[
              { value: '7d', label: t.range7d },
              { value: '30d', label: t.range30d },
              { value: '90d', label: t.range90d },
              { value: 'all', label: t.rangeAll },
            ]}
            onChange={setRange}
            testId="stats-range"
          />
          <a
            className={styles.export}
            data-testid="stats-export"
            href={`/stats/export?network=${filter}&range=${range}&mode=${mode}`}
          >
            {t.exportCsv}
          </a>
          <Segmented
            label={t.langLabel}
            value={lang}
            options={[
              { value: 'en', label: t.langEn },
              { value: 'es', label: t.langEs },
            ]}
            onChange={chooseLang}
            testId="stats-lang"
          />
          <button
            type="button"
            className={styles.theme}
            data-testid="stats-theme"
            aria-pressed={theme === 'dark'}
            aria-label={theme === 'dark' ? t.themeToLight : t.themeToDark}
            onClick={() => chooseTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <ThemeIcon theme={theme} />
          </button>
        </div>
      </header>
      <main id="metrics" tabIndex={-1} className={styles.main}>
        <p className={styles.srOnly} aria-live="polite">
          {format(t.filterStatus, { network: t[networkNameKey(filter)], range: rangeLabel })}
        </p>
        <section className={styles.hero}>
          <h1>{t.heroTitle}</h1>
          <p>{t.heroSubtitle}</p>
          <p className={styles.updated} data-testid="stats-updated">
            {snapshot.updatedAt ? (
              <time dateTime={snapshot.updatedAt}>
                {format(t.updatedAt, { time: formatUpdatedAt(snapshot.updatedAt, lang) })}
              </time>
            ) : (
              <time dateTime={snapshot.asOf}>{format(t.updatedAt, { time: snapshot.asOf })}</time>
            )}
            {t.sep}
            {freshness}
          </p>
        </section>
        <section className={styles.kpis} aria-label={t.kpiRegion} data-testid="stats-kpis">
          {cards.map((card) => (
            <article key={card.id} className={styles.card} data-testid={`stats-kpi-${card.id}`}>
              <h2 className={styles.kpiLabel}>{t[kpiTitleKey(card.id)]}</h2>
              <p className={styles.kpiValue}>{formatInt(card.value, lang)}</p>
              <p className={styles.kpiDetail}>{phraseLine(card.parts, lang)}</p>
            </article>
          ))}
        </section>
        <section aria-labelledby="stats-growth" data-testid="stats-growth">
          <div className={styles.sectionHead}>
            <h2 id="stats-growth" className={styles.kicker}>
              {panel === 'overview' ? t.growth : t.recent}
            </h2>
            <div className={styles.sectionTools}>
              <Segmented
                label={t.tabLabel}
                value={panel}
                options={[
                  { value: 'overview', label: t.tabOverview },
                  { value: 'transactions', label: t.tabTransactions },
                ]}
                onChange={setPanel}
                testId="stats-tab"
              />
              {panel === 'overview' ? (
                <Segmented
                  label={t.modeLabel}
                  value={mode}
                  options={[
                    { value: 'cumulative', label: t.modeCumulative },
                    { value: 'daily', label: t.modeDaily },
                  ]}
                  onChange={setMode}
                  testId="stats-mode"
                />
              ) : null}
            </div>
          </div>
          {panel === 'overview' ? (
            <div className={styles.overview}>
              <ChartCard kind="tx" title={t.chartTx} range={range} mode={mode} filter={filter} lang={lang} snapshot={snapshot} />
              <ChartCard kind="carts" title={t.chartCarts} range={range} mode={mode} filter={filter} lang={lang} snapshot={snapshot} />
              <article className={styles.card} data-testid="stats-by-network">
                <h3 className={styles.cardTitle}>{t.byNetwork}</h3>
                <MeterList rows={networkMeters(filter, snapshot)} lang={lang} />
              </article>
              <article className={styles.card} data-testid="stats-engineering">
                <h3 className={styles.cardTitle}>{t.engineering}</h3>
                <div className={styles.minis}>
                  <div className={styles.mini}>
                    <p className={styles.miniLabel}>{t.passingTests}</p>
                    <p className={styles.miniValue}>{formatInt(engineeringTests(filter), lang)}</p>
                    <p className={styles.miniScope}>{t.testsScope}</p>
                  </div>
                  <div className={styles.mini}>
                    <p className={styles.miniLabel}>{t.mergedPrs}</p>
                    <p className={styles.miniValue}>{formatInt(snapshot.totals.mergedPrs, lang)}</p>
                    <p className={styles.miniScope}>{t.prsScope}</p>
                  </div>
                </div>
                <MeterList rows={engineeringMeters(filter)} lang={lang} />
              </article>
            </div>
          ) : (
            <article className={styles.card}>
              {txs.length === 0 ? (
                <p className={styles.empty}>{t.emptyTx}</p>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table} data-testid="stats-tx-table">
                    <thead>
                      <tr>
                        <th scope="col">{t.colNetwork}</th>
                        <th scope="col">{t.colTx}</th>
                        <th scope="col">{t.colContract}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {txs.map((tx) => {
                        const id = shortId(tx.hash);
                        const program = shortId(contractId(tx.network));
                        const networkLabel = tx.network === 'solana' ? t.chainSolana : t.chainStellar;
                        return (
                          <tr key={tx.hash} data-testid={`stats-tx-${tx.hash.slice(0, 8)}`}>
                            <td>
                              <span className={styles.netBadge} data-tone={tx.network}>
                                {networkLabel}
                              </span>
                            </td>
                            <td>
                              <a
                                href={txHref(tx)}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={format(t.linkLabel, { id, hint: t.newTab })}
                              >
                                {id}
                              </a>
                            </td>
                            <td>
                              <a
                                href={contractHref(tx.network)}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={format(t.linkLabel, { id: program, hint: t.newTab })}
                              >
                                {program}
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          )}
        </section>
      </main>
      <footer className={styles.footer} data-testid="stats-footer">
        <img className={styles.footerMark} src="/brand/mascot-idle.png" alt="" width={397} height={583} />
        <span className={styles.footerWord}>{t.brand}</span>
      </footer>
    </div>
  );
}
