/**
 * Where someone heard about Changuito.
 *
 * `value` is what the form submits and what the webhook stores. Labels in
 * the Spanish form are those same values. English labels are listed here
 * so an EN form can show them, and the server accepts them and stores the
 * Spanish value so the sheet stays consistent.
 */

export const SOURCE_QUESTION = {
  es: '¿Dónde te enteraste de nosotros?',
  en: 'How did you hear about us?',
} as const;

export const SOCIAL_SOURCES = [
  'Instagram',
  'X (Twitter)',
  'LinkedIn',
  'TikTok',
  'YouTube',
  'Facebook',
  'Telegram',
] as const;

export const PERSON_SOURCES = ['Por Fabio', 'Por Simoneth'] as const;

export const OTHER_SOURCE = 'Otros';

/** English labels for values that are not already the same in both languages. */
export const SOURCE_LABEL_EN: Record<string, string> = {
  'Por Fabio': 'Through Fabio',
  'Por Simoneth': 'Through Simoneth',
  [OTHER_SOURCE]: 'Other',
  Equipo: 'Team',
  'Redes sociales': 'Social media',
  Otros: 'Other',
};

/** English answers the server accepts and rewrites to the stored Spanish value. */
const SOURCE_ALIASES: Record<string, string> = {
  'Through Fabio': 'Por Fabio',
  'Through Simoneth': 'Por Simoneth',
  Other: OTHER_SOURCE,
};

export const SOURCE_GROUPS = [
  { id: 'people', label: 'Equipo', options: PERSON_SOURCES },
  { id: 'social', label: 'Redes sociales', options: SOCIAL_SOURCES },
  { id: 'other', label: 'Otros', options: [OTHER_SOURCE] as const },
] as const;

export function allowedSources(): ReadonlySet<string> {
  const values: string[] = Object.keys(SOURCE_ALIASES);
  for (const group of SOURCE_GROUPS) {
    for (const option of group.options) values.push(option);
  }
  return new Set(values);
}

/** Stored value for a submitted source, or undefined if it is not on the list. */
export function canonicalSource(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  const alias = SOURCE_ALIASES[value];
  if (alias) return alias;
  for (const group of SOURCE_GROUPS) {
    for (const option of group.options) {
      if (option === value) return option;
    }
  }
  return undefined;
}

export function sourceLabel(value: string, lang: 'es' | 'en' = 'es'): string {
  if (lang === 'en') return SOURCE_LABEL_EN[value] ?? value;
  return value;
}
