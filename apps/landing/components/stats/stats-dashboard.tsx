'use client';

import { useEffect, useId, useRef, useState } from 'react';

import {
  LANG_KEY,
  THEME_KEY,
  format,
  formatInt,
  messages,
  parseLang,
  parseTheme,
  phraseLine,
  type Lang,
  type ThemeName,
} from '../../lib/stats/i18n';
import { HOME_URL, TOTALS, contractHref, contractId, shortId, txHref } from '../../lib/stats/metrics';
import {
  barRatio,
  engineeringMeters,
  engineeringTests,
  kpiTitleKey,
  kpis,
  meterPeak,
  networkMeters,
  networkNameKey,
  plotTop,
  pointsFor,
  projectSeries,
  recentTxs,
  seriesPeak,
  sumSeries,
  visibleChains,
  type Granularity,
  type Meter,
  type NetworkFilter,
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

function ChartCard({
  kind,
  title,
  granularity,
  cumulative,
  filter,
  lang,
}: {
  kind: SeriesKind;
  title: string;
  granularity: Granularity;
  cumulative: boolean;
  filter: NetworkFilter;
  lang: Lang;
}) {
  const t = messages(lang);
  const titleId = useId();
  const points = pointsFor(kind, granularity);
  const bars = projectSeries(points, filter, cumulative);
  const chains = visibleChains(filter);
  const top = plotTop(seriesPeak(bars, filter));
  const total = sumSeries(points, filter);
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
      name: chain === 'solana' ? t.legendSolana : t.legendStellar,
      count: formatInt(chain === 'solana' ? bar.solana : bar.stellar, lang),
    });
  }

  const activeTip = active === null ? '' : tipFor(active);

  return (
    <article className={styles.card} data-testid={`stats-chart-${kind}`} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.chartTitle}>
        {title}
      </h3>
      <p className={styles.chartTotal}>{formatInt(total, lang)}</p>
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
      <ul className={styles.legend}>
        {chains.map((chain) => (
          <li key={chain}>
            <span className={styles.dot} style={{ background: `var(--bar-${chain})` }} aria-hidden="true" />
            {chain === 'solana' ? t.legendSolana : t.legendStellar}
          </li>
        ))}
      </ul>
      <p className={styles.readout}>{activeTip}</p>
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

export function StatsDashboard() {
  const [lang, setLang] = useState<Lang>('en');
  const [theme, setTheme] = useState<ThemeName>('dark');
  const [filter, setFilter] = useState<NetworkFilter>('all');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [cumulative, setCumulative] = useState(false);
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

  const cards = kpis(filter);
  const txs = recentTxs(filter);
  const networkOptions = [
    { value: 'all' as const, label: t.netAll },
    { value: 'solana' as const, label: t.netSolana },
    { value: 'stellar' as const, label: t.netStellar },
  ];
  const bucketOptions = [
    { value: 'month' as const, label: t.month },
    { value: 'day' as const, label: t.day },
  ];

  return (
    <div className={styles.shell} data-theme={theme} data-testid="stats-screen" lang={lang}>
      <a className={styles.skip} href="#metrics">
        {t.skip}
      </a>
      <header className={styles.header} data-testid="stats-header">
        <div className={styles.brand}>
          <a className={styles.brandLink} href={HOME_URL} data-testid="stats-brand">
            <img className={styles.logo} src="/brand/mascot-idle.png" alt="" width={397} height={583} />
            <span>{t.brand}</span>
          </a>
          <span className={styles.badge}>{t.badge}</span>
        </div>
        <div className={styles.tools}>
          <a className={styles.back} href={HOME_URL} data-testid="stats-home">
            {t.back}
          </a>
          <Segmented
            label={t.networkLabel}
            value={filter}
            options={networkOptions}
            onChange={setFilter}
            testId="stats-network"
          />
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
          {format(t.filterStatus, { network: t[networkNameKey(filter)] })}
        </p>
        <section className={styles.hero}>
          <h1>{t.heroTitle}</h1>
          <p>{t.heroSubtitle}</p>
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
              {t.growth}
            </h2>
            <div className={styles.sectionTools}>
              <Segmented
                label={t.granularityLabel}
                value={granularity}
                options={bucketOptions}
                onChange={setGranularity}
                testId="stats-bucket"
              />
              <button
                type="button"
                className={styles.pill}
                data-testid="stats-cumulative"
                aria-pressed={cumulative}
                onClick={() => setCumulative((current) => !current)}
              >
                {t.cumulative}
              </button>
            </div>
          </div>
          <div className={styles.chartGrid}>
            <ChartCard
              kind="tx"
              title={t.chartTx}
              granularity={granularity}
              cumulative={cumulative}
              filter={filter}
              lang={lang}
            />
            <ChartCard
              kind="carts"
              title={t.chartCarts}
              granularity={granularity}
              cumulative={cumulative}
              filter={filter}
              lang={lang}
            />
          </div>
        </section>
        <section aria-labelledby="stats-breakdown" data-testid="stats-breakdown">
          <div className={styles.sectionHead}>
            <h2 id="stats-breakdown" className={styles.kicker}>
              {t.breakdown}
            </h2>
          </div>
          <div className={styles.split}>
            <article className={styles.card} data-testid="stats-by-network">
              <h3 className={styles.cardTitle}>{t.byNetwork}</h3>
              <MeterList rows={networkMeters(filter)} lang={lang} />
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
                  <p className={styles.miniValue}>{formatInt(TOTALS.mergedPrs, lang)}</p>
                  <p className={styles.miniScope}>{t.prsScope}</p>
                </div>
              </div>
              <MeterList rows={engineeringMeters(filter)} lang={lang} />
            </article>
          </div>
        </section>
        <section aria-labelledby="stats-recent">
          <div className={styles.sectionHead}>
            <h2 id="stats-recent" className={styles.kicker}>
              {t.recent}
            </h2>
          </div>
          <article className={styles.card}>
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
                          <td>{networkLabel}</td>
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
          </article>
        </section>
      </main>
    </div>
  );
}
