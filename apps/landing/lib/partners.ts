/**
 * Partner lockup for the landing footer.
 *
 * Identifiers and files only. Prices, taglines and the grey / color
 * treatment live in CSS, and each name is the link text so a picture
 * cannot invent a word. AcademiaQA and BAF are the mono wordmarks.
 * Superteam Argentina stays a color badge.
 */
export const PARTNERS = [
  {
    id: 'academiaqa',
    href: 'https://academiaqa.com',
    label: 'AcademiaQA',
    src: '/brand/partners/academiaqa-mono.png',
    width: 418,
    height: 96,
    mono: true,
  },
  {
    id: 'superteam',
    href: 'https://superteam.fun/earn/regions/argentina/',
    label: 'Superteam Argentina',
    src: '/brand/partners/superteam-ar-color.png',
    width: 96,
    height: 96,
    mono: false,
  },
  {
    id: 'baf',
    href: 'https://blockchainacceleration.org',
    label: 'BAF Network',
    src: '/brand/partners/baf-mono.svg',
    width: 85,
    height: 26,
    mono: true,
  },
] as const;
