export { pluralCategories } from '@speechifyinc/loqo-sdk';

/** Glossary locale key for a value that applies to every target locale; a locale's own value overrides it. */
export const ALL_LOCALES = '*';

const displayNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' });

export const localeName = (locale: string, overrides: Record<string, string> = {}): string => {
  const override = overrides[locale];
  if (override) return override;
  try {
    return displayNames.of(locale) ?? locale;
  } catch {
    return locale;
  }
};

