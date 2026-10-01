import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { localeName } from '../../core/model/locales';
import { localeFlag } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input, Select } from './ui/input';

const COMMON_LOCALES = [
  'af', 'ar', 'az', 'be', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'en-gb', 'es', 'es-mx', 'et', 'fa', 'fi', 'fil', 'fr', 'fr-ca', 'ga', 'gu',
  'he', 'hi', 'hr', 'hu', 'hy', 'id', 'is', 'it', 'ja', 'ka', 'kk', 'kn', 'ko', 'lt', 'lv', 'mk', 'ml', 'mr', 'ms', 'nb', 'nl', 'pa', 'pl', 'pt',
  'pt-br', 'ro', 'ru', 'sk', 'sl', 'sq', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'uz', 'vi', 'zh-hans', 'zh-hans-cn', 'zh-hant', 'zh-hant-tw',
];

const LOCALE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;

const isLocale = (candidate: string): boolean => {
  if (!LOCALE_PATTERN.test(candidate)) return false;
  try {
    return Intl.getCanonicalLocales(candidate).length === 1;
  } catch {
    return false;
  }
};

const localeLabel = (locale: string): string => [localeFlag(locale), locale].filter(Boolean).join(' ');

const matches = (locale: string, needle: string): boolean => locale.includes(needle) || localeName(locale).toLowerCase().includes(needle);

type LocaleMultiSelectProps = { id?: string; value: string[]; onChange: (locales: string[]) => void };

/** Chips for the chosen locales and a searchable list to add more; any valid BCP 47 code can be typed in. */
export const LocaleMultiSelect = ({ id, value, onChange }: LocaleMultiSelectProps) => {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const options = [...new Set([...value, ...COMMON_LOCALES])].filter((locale) => matches(locale, needle));
  const custom = needle && !options.includes(needle) && isLocale(needle) ? needle : null;
  const toggle = (locale: string) => onChange(value.includes(locale) ? value.filter((selected) => selected !== locale) : [...value, locale]);

  return (
    <Popover.Root onOpenChange={(open) => !open && setQuery('')}>
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input px-2 py-1 shadow-xs">
        {value.map((locale) => (
          <Badge key={locale} variant="secondary" className="gap-1" title={localeName(locale)}>
            {localeLabel(locale)}
            <button type="button" aria-label={`Remove ${locale}`} className="rounded-sm hover:bg-muted" onClick={() => toggle(locale)}>
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <Popover.Trigger asChild>
          <Button id={id} type="button" variant="ghost" size="sm" className="ml-auto">
            Add <ChevronsUpDown />
          </Button>
        </Popover.Trigger>
      </div>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={4} className="z-50 w-72 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <Input
            autoFocus
            placeholder="Search or type a code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const pick = custom ?? options[0];
              if (pick) toggle(pick);
              setQuery('');
            }}
          />
          <div role="listbox" aria-multiselectable className="mt-1 max-h-64 overflow-y-auto">
            {(custom ? [custom, ...options] : options).map((locale) => (
              <button
                key={locale}
                type="button"
                role="option"
                aria-selected={value.includes(locale)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => toggle(locale)}
              >
                <Check className={value.includes(locale) ? 'size-4' : 'size-4 invisible'} />
                <span className="w-5">{localeFlag(locale)}</span>
                <span className="font-mono text-xs">{locale}</span>
                <span className="truncate text-muted-foreground">{localeName(locale)}</span>
              </button>
            ))}
            {options.length === 0 && !custom ? <p className="px-2 py-1.5 text-sm text-muted-foreground">No locale matches.</p> : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

type LocaleSelectProps = { value: string; locales: string[]; taken: string[]; onChange: (locale: string) => void };

/** One locale out of the project's targets, skipping those a sibling row already uses. */
export const LocaleSelect = ({ value, locales, taken, onChange }: LocaleSelectProps) => (
  <Select aria-label="Locale" className="w-36 shrink-0" value={value} onChange={(e) => onChange(e.target.value)}>
    {[...new Set([value, ...locales])]
      .filter((locale) => locale === value || !taken.includes(locale))
      .map((locale) => (
        <option key={locale} value={locale}>
          {localeLabel(locale)}
        </option>
      ))}
  </Select>
);
