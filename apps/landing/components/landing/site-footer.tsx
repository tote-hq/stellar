import { NEW_TAB_HINT } from '@changuito/trust';
import { FounderTrust } from '@changuito/trust/ui';

import { FOOTER, NAV, SOCIAL } from '../../lib/copy';
import { PARTNERS } from '../../lib/partners';
import { BrandLockup } from './brand-lockup';
import { InstagramIcon, LinkedInIcon, XIcon } from './icons';

import styles from './landing.module.css';

/**
 * Site footer shared by the home and /whitelist.
 * navBase prefixes the in-page anchors so they resolve to the home from
 * other routes. trust=false skips the founder line on pages that already
 * show it above the fold.
 */
export function SiteFooter({ navBase = '', trust = true }: { navBase?: string; trust?: boolean }) {
  return (
    <footer className={styles.footer} data-testid="landing-footer">
      <div className={styles.footerInner}>
        <a className={styles.logoLink} href="/">
          <BrandLockup className={styles.footerBrand} />
        </a>
        <div className={styles.powered} role="group" aria-labelledby="landing-powered-label" data-testid="landing-powered">
          <span id="landing-powered-label" className={styles.poweredLabel} lang="en">
            Powered by
          </span>
          <ul className={styles.poweredList}>
            {PARTNERS.map((partner) => (
              <li key={partner.id}>
                <a
                  className={partner.mono ? `${styles.poweredLink} ${styles.mono}` : `${styles.poweredLink} ${styles.color}`}
                  href={partner.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${partner.label} (${NEW_TAB_HINT})`}
                  data-testid={`landing-powered-${partner.id}`}
                >
                  <img src={partner.src} alt="" width={partner.width} height={partner.height} decoding="async" />
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.footerMeta}>
          <nav aria-label="Pie" className={styles.footerNavWrap}>
            <ul className={styles.footerNav}>
              {NAV.map((link) => (
                <li key={link.href}>
                  <a className={styles.footerLink} href={`${navBase}${link.href}`}>
                    {link.label}
                  </a>
                </li>
              ))}
              <li>
                <a className={styles.footerLink} href="/reportarbug" data-testid="landing-report-bug">
                  Reportar un bug
                </a>
              </li>
              <li>
                <a className={styles.footerLink} href="/">
                  {FOOTER.siteLabel}
                </a>
              </li>
            </ul>
          </nav>
          <ul className={styles.footerSocial} data-testid="landing-social">
            {SOCIAL.map((link) => (
              <li key={link.href}>
                <a
                  className={styles.socialLink}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={link.ariaLabel}
                  data-testid={`landing-social-${link.icon}`}
                >
                  {link.icon === 'instagram' ? <InstagramIcon className={styles.socialIcon} /> : null}
                  {link.icon === 'x' ? <XIcon className={styles.socialIcon} /> : null}
                  {link.icon === 'linkedin' ? <LinkedInIcon className={styles.socialIcon} /> : null}
                  <span>{link.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className={styles.fine}>{FOOTER.legal}</p>
      {trust ? <FounderTrust className={styles.fine} /> : null}
    </footer>
  );
}
