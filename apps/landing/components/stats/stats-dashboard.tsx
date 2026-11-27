'use client';

import { useEffect, useState } from 'react';

import {
  LANG_KEY,
  THEME_KEY,
  formatInt,
  messages,
  parseLang,
  parseTheme,
  type Lang,
  type ThemeName,
} from '../../lib/stats/i18n';
import { HOME_URL, type StatsSnapshot } from '../../lib/stats/metrics';
import { kpiMark, kpiTitleKey, kpis, type Kpi } from '../../lib/stats/view';
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

function StaleMark({ label }: { label: string }) {
  return (
    <span className={styles.stale}>
      <span className={styles.staleDot} aria-hidden="true" />
      <span className={styles.staleText}>{label}</span>
    </span>
  );
}

export function StatsDashboard({ snapshot }: { snapshot: StatsSnapshot }) {
  const [theme, setTheme] = useState<ThemeName>('light');
  const [lang, setLang] = useState<Lang>('en');
  useEffect(() => {
    setTheme(parseTheme(readStorage(THEME_KEY)));
    setLang(parseLang(readStorage(LANG_KEY)));
  }, []);

  function chooseTheme(next: ThemeName) {
    setTheme(next);
    writeStorage(THEME_KEY, next);
  }

  function chooseLang(next: Lang) {
    setLang(next);
    writeStorage(LANG_KEY, next);
  }

  const t = messages(lang);
  const cards = kpis(snapshot);

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
          <button
            type="button"
            className={styles.lang}
            data-testid="stats-lang"
            aria-label={lang === 'en' ? t.langToEs : t.langToEn}
            onClick={() => chooseLang(lang === 'en' ? 'es' : 'en')}
          >
            {lang === 'en' ? t.langEs : t.langEn}
          </button>
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
        <section className={styles.hero}>
          <h1>{t.heroTitle}</h1>
        </section>
        <section className={styles.kpis} aria-label={t.kpiRegion} data-testid="stats-kpis">
          {cards.map((card) => (
            <KpiCard key={card.id} card={card} snapshot={snapshot} lang={lang} />
          ))}
        </section>
      </main>
      <footer className={styles.footer} data-testid="stats-footer">
        <img className={styles.footerMark} src="/brand/mascot-idle.png" alt="" width={397} height={583} />
        <span className={styles.footerWord}>{t.brand}</span>
      </footer>
    </div>
  );
}

function KpiCard({
  card,
  snapshot,
  lang,
}: {
  card: Kpi;
  snapshot: StatsSnapshot;
  lang: Lang;
}) {
  const t = messages(lang);
  const mark = kpiMark(card.id, snapshot, t);
  return (
    <article className={styles.card} data-testid={`stats-kpi-${card.id}`}>
      <h2 className={styles.kpiLabel}>
        {t[kpiTitleKey(card.id)]}
        {mark ? <StaleMark label={mark} /> : null}
      </h2>
      <p className={styles.kpiValue}>{formatInt(card.value, lang)}</p>
    </article>
  );
}
