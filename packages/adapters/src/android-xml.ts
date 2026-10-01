import { basename, dirname, join } from 'node:path';
import { type Adapter, pluralCategories, pluralSpecifiers, type PulledResource, type PushResource, unwrapAndroidQuotes } from '@speechifyinc/loqo-sdk';
import {
  compositeKey,
  discoverFiles,
  type FileAdapterOptions,
  parseCompositeKey,
  readText,
  readTextIfExists,
  toFileLocale,
  writeText,
} from './files';

export type AndroidXmlOptions = Omit<FileAdapterOptions, 'include'> & { include?: string[] };

type Attributes = Record<string, string>;

const parseAttributes = (raw: string): Attributes =>
  Object.fromEntries([...raw.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [name ?? '', value ?? '']));

// Comments and elements are matched in one left-to-right pass so a `<string` inside a comment is
// skipped. `<string` is followed by a lookahead rather than `\b`, which would also match `<string-array`.
const ELEMENT_SCAN =
  /<!--[\s\S]*?-->|<string(?=[\s/>])([^>]*?)(?:\/>|>([\s\S]*?)<\/string>)|<plurals\b([^>]*)>([\s\S]*?)<\/plurals>|<string-array\b([^>]*)>([\s\S]*?)<\/string-array>/g;
const ITEM_SCAN = /<item\b([^>]*)>([\s\S]*?)<\/item>/g;

/** `raw` is the element's inner XML as written; `value` is what the platform sees. */
type ParsedValue = { raw: string; value: string };

type ParsedResource =
  | ({ kind: 'string'; name: string; attrs: Attributes } & ParsedValue)
  | { kind: 'plurals'; name: string; attrs: Attributes; items: ({ quantity: string } & ParsedValue)[] }
  | { kind: 'string-array'; name: string; attrs: Attributes; items: ParsedValue[] };

const isComposeResource = (filePath: string): boolean => filePath.includes('/composeResources/');

/**
 * Inner content is kept raw apart from aapt quoting: xliff wrappers, entities and inline tags are part
 * of the value. Compose Multiplatform does not apply aapt quoting, so a `"` there is a literal character.
 */
export const parseAndroidResources = (xml: string, filePath: string): ParsedResource[] => {
  const read = (raw = ''): ParsedValue => ({ raw, value: isComposeResource(filePath) ? raw : unwrapAndroidQuotes(raw) });
  const parsed: ParsedResource[] = [];
  for (const match of xml.matchAll(ELEMENT_SCAN)) {
    const [, stringAttrs, stringValue, pluralAttrs, pluralBody, arrayAttrs, arrayBody] = match;
    if (stringAttrs !== undefined) {
      const attrs = parseAttributes(stringAttrs);
      if (attrs.name) parsed.push({ kind: 'string', name: attrs.name, attrs, ...read(stringValue) });
    } else if (pluralAttrs !== undefined) {
      const attrs = parseAttributes(pluralAttrs);
      const items = [...(pluralBody ?? '').matchAll(ITEM_SCAN)].map(([, itemAttrs, value]) => ({
        quantity: parseAttributes(itemAttrs ?? '').quantity ?? 'other',
        ...read(value),
      }));
      if (attrs.name) parsed.push({ kind: 'plurals', name: attrs.name, attrs, items });
    } else if (arrayAttrs !== undefined) {
      const attrs = parseAttributes(arrayAttrs);
      const items = [...(arrayBody ?? '').matchAll(ITEM_SCAN)].map(([, , value]) => read(value));
      if (attrs.name) parsed.push({ kind: 'string-array', name: attrs.name, attrs, items });
    }
  }
  return parsed;
};

/** Where a unit sits in its resource: a plural quantity, an array index, or `''` for a plain string. */
type Part = string | number;

/** One translatable unit of a file: a string, a plural category or an array item. */
const unitId = (name: string, part: Part = ''): string => (part === '' ? name : `${name}#${part}`);

/** A duplicated name resolves to its first non-blank value. */
const unitsOf = (parsed: ParsedResource[]): Map<string, ParsedValue> => {
  const units = new Map<string, ParsedValue>();
  const add = (id: string, unit: ParsedValue) => {
    if (!units.get(id)?.value.trim()) units.set(id, unit);
  };
  for (const resource of parsed) {
    if (resource.kind === 'string') add(unitId(resource.name), resource);
    else if (resource.kind === 'plurals') for (const item of resource.items) add(unitId(resource.name, item.quantity), item);
    else resource.items.forEach((item, index) => add(unitId(resource.name, index), item));
  }
  return units;
};

/** A resource as written: its units' inner XML, keyed by part. A string and a plural may share a name. */
type Group = { kind: ParsedResource['kind']; name: string; formatted?: string; items: Map<Part, string> };

const groupKey = (kind: Group['kind'], name: string): string => `${kind}:${name}`;

const XLIFF_WRAPPER = /<xliff:g\b[^>]*>([\s\S]*?)<\/xliff:g>/g;

/**
 * An `<xliff:g>` wrapper only annotates its content for translators, so one the source does not
 * carry is dropped from an existing translation rather than counted as a difference.
 */
const asTarget = (existing: string, source: string): string =>
  source.includes('<xliff:g') ? existing : existing.replace(XLIFF_WRAPPER, '$1');

const PLURAL_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** Plain code-point order, the same `Array.prototype.sort()` the old import action used. */
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Every CLDR category any target locale uses beyond the source's own. */
const synthesizedQuantities = (project: { sourceLocale: string; targetLocales: string[] }): string[] => {
  const source = pluralCategories(project.sourceLocale);
  const all = new Set<string>();
  for (const locale of project.targetLocales) for (const category of pluralCategories(locale)) all.add(category);
  return PLURAL_ORDER.filter((quantity) => all.has(quantity) && !source.has(quantity));
};

/** Markup Android renders in any string resource; a source may add more (`<strike>`, `<font>`). */
const BASE_TAGS = new Set(['xliff:g', 'b', 'i', 'u']);

const tagNamesIn = (value: string): Set<string> =>
  new Set([...value.matchAll(/<\/?([a-zA-Z][\w:-]*)/g)].map((match) => (match[1] ?? '').toLowerCase()));

/**
 * Only markup the source already carries may reach the file as real tags; anything else that opens
 * with `<` is text the translator wrote, and text has to be escaped or the file is not XML.
 */
const escapeStrayMarkup = (value: string, allowed: Set<string>): string =>
  value.replace(/<(\/?)([a-zA-Z][\w:-]*)?/g, (match, _slash: string, name: string | undefined) =>
    name && allowed.has(name.toLowerCase()) ? match : `&lt;${match.slice(1)}`,
  );

const CDATA = /(<!\[CDATA\[[\s\S]*?\]\]>)/;

const normalizeText = (value: string, allowed: Set<string>): string =>
  escapeStrayMarkup(
    value
      .replace(/<br\s*\/?>/gi, '\\n')
      .replace(/[\u00A0\u202F\u2007]/g, ' ')
      .replace(/[\u2060\u0000\u200B\u200C\u200D\uFEFF]/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;'),
    allowed,
  );

/** CDATA sections travel verbatim; everything between them is normalized and escaped. */
const normalizeXmlValue = (value: string, allowed: Set<string>): string =>
  value
    .split(CDATA)
    .map((segment) => (CDATA.test(segment) ? segment : normalizeText(segment, allowed)))
    .join('');

const keepQuotes = (value: string): string => (value.startsWith('"') && value.endsWith('"') ? value : `"${value}"`);

/**
 * Compose Multiplatform reads values via `textContent` and neither unwraps aapt-style quoting nor
 * decodes `\'`; classic `res/` needs both.
 */
const sanitizeXmlValue = (value: string, source: string, filePath: string): string => {
  const allowed = new Set([...BASE_TAGS, ...tagNamesIn(source)]);
  return isComposeResource(filePath)
    ? normalizeXmlValue(value, allowed)
    : normalizeXmlValue(keepQuotes(value), allowed).replace(/(?<!\\)'/g, "\\'");
};

/** `values-xx` or `values-xx-rYY`, unless the project maps the locale explicitly. */
const localeFolder = (locale: string, localeMap: Record<string, string> = {}): string => {
  const mapped = toFileLocale(locale, localeMap);
  if (mapped !== locale) return mapped.startsWith('values-') ? mapped : `values-${mapped}`;
  const [language, region] = locale.split('-');
  return region ? `values-${language}-r${region.toUpperCase()}` : `values-${language}`;
};

const attrString = (attrs: Record<string, string | undefined>): string =>
  Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('');

/**
 * Android `values/strings.xml` (+ `plurals.xml`). Mirrors the old import: `translatable="false"`
 * disables the key, single-element resources parse fine, aapt quoting (classic `res/` only) is
 * unwrapped on the way in and restored on the way out, and plural categories the source language
 * lacks are seeded from `other`. Push keeps every existing value the platform does not replace.
 */
export const androidXml = (options: AndroidXmlOptions): Adapter => {
  const fileOptions: FileAdapterOptions = { include: ['**/values/strings.xml', '**/values/plurals.xml'], ...options };

  const localeFilePath = (filePath: string, locale: string): string =>
    join(dirname(dirname(filePath)), localeFolder(locale, options.localeMap), basename(filePath));

  return {
    name: 'android-xml',

    async pull({ project }) {
      const resources: PulledResource[] = [];
      const extraQuantities = synthesizedQuantities(project);

      for (const filePath of await discoverFiles(fileOptions)) {
        const parsed = parseAndroidResources(await readText(options.root, filePath), filePath);
        const localeUnits = new Map<string, Map<string, ParsedValue>>();
        for (const locale of project.targetLocales) {
          const localePath = localeFilePath(filePath, locale);
          const xml = await readTextIfExists(options.root, localePath);
          if (xml !== null) localeUnits.set(locale, unitsOf(parseAndroidResources(xml, localePath)));
        }
        const targetsFor = (id: string, source: string): Record<string, string> =>
          Object.fromEntries(
            project.targetLocales.flatMap((locale) => {
              const existing = localeUnits.get(locale)?.get(id)?.value;
              return existing?.trim() ? [[locale, asTarget(existing, source)]] : [];
            }),
          );

        for (const resource of parsed) {
          const translatable = resource.attrs.translatable !== 'false';
          const formatted = resource.attrs.formatted;
          const base = { filePath, key: resource.name, formatted };

          if (resource.kind === 'string') {
            resources.push({
              key: compositeKey(base),
              source: resource.value,
              tags: ['android', 'string'],
              meta: { ...base },
              translatable,
              targets: targetsFor(unitId(resource.name), resource.value),
            });
          } else if (resource.kind === 'plurals') {
            const other = resource.items.find((item) => item.quantity === 'other');
            const shared = pluralSpecifiers(resource.items.map((item) => item.value));
            const items = [
              ...resource.items.map(({ quantity, value }) => ({ quantity, value })),
              ...extraQuantities
                .filter((quantity) => other && !resource.items.some((item) => item.quantity === quantity))
                .map((quantity) => ({ quantity, value: other?.value ?? '', synthesized: true })),
            ];
            for (const item of items) {
              const tags = ['android', 'plural', ...('synthesized' in item ? ['synthesized'] : [])];
              resources.push({
                key: compositeKey({ ...base, quantity: item.quantity }),
                source: item.value,
                tags,
                meta: { ...base, quantity: item.quantity, pluralSpecifiers: shared },
                translatable,
                targets: targetsFor(unitId(resource.name, item.quantity), item.value),
              });
            }
          } else {
            resource.items.forEach(({ value }, index) => {
              resources.push({
                key: compositeKey({ ...base, index }),
                source: value,
                tags: ['android', 'string-array'],
                meta: { ...base, index },
                translatable,
                targets: targetsFor(unitId(resource.name, index), value),
              });
            });
          }
        }
      }
      return { resources };
    },

    async push({ project }, resources: PushResource[]) {
      const byFile = new Map<string, PushResource[]>();
      for (const resource of resources) {
        if (!resource.translatable) continue;
        const filePath = parseCompositeKey(resource.key)?.filePath;
        if (typeof filePath !== 'string') continue;
        byFile.set(filePath, [...(byFile.get(filePath) ?? []), resource]);
      }

      let written = 0;
      const files: string[] = [];
      for (const [filePath, fileResources] of byFile) {
        const sourceXml = await readTextIfExists(options.root, filePath);
        const sourceResources = (sourceXml === null ? [] : parseAndroidResources(sourceXml, filePath)).filter(
          (resource) => resource.attrs.translatable !== 'false',
        );
        for (const locale of project.targetLocales) {
          const categories = pluralCategories(locale);
          const localePath = localeFilePath(filePath, locale);
          const existingXml = await readTextIfExists(options.root, localePath);
          const existing = existingXml === null ? new Map<string, ParsedValue>() : unitsOf(parseAndroidResources(existingXml, localePath));
          const groups = new Map<string, Group>();
          const place = (name: string, kind: Group['kind'], part: Part, formatted: string | undefined, xml: string) => {
            const group = groups.get(groupKey(kind, name)) ?? { kind, name, formatted, items: new Map<Part, string>() };
            group.items.set(part, xml);
            groups.set(groupKey(kind, name), group);
          };

          for (const resource of fileResources) {
            const value = resource.targets[locale]?.value;
            const parsed = parseCompositeKey(resource.key);
            const key = parsed?.key;
            if (!value?.trim() || typeof key !== 'string') continue;
            const formatted = typeof parsed?.formatted === 'string' ? parsed.formatted : undefined;
            const [kind, part]: [Group['kind'], Part] =
              typeof parsed?.quantity === 'string' ? ['plurals', parsed.quantity] : typeof parsed?.index === 'number' ? ['string-array', parsed.index] : ['string', ''];
            if (kind === 'plurals' && !categories.has(String(part))) continue;
            // A value the file already says is written back as the file says it, byte for byte.
            const kept = existing.get(unitId(key, part));
            const xml = kept && asTarget(kept.value, resource.source) === value ? kept.raw : sanitizeXmlValue(value, resource.source, filePath);
            place(key, kind, part, formatted, xml);
          }

          // Whatever the platform did not hand back (rejected, re-translating, outside a delta) stays as the file has it.
          for (const resource of sourceResources) {
            const parts: Part[] =
              resource.kind === 'string' ? [''] : resource.kind === 'plurals' ? PLURAL_ORDER.filter((quantity) => categories.has(quantity)) : resource.items.map((_, index) => index);
            for (const part of parts) {
              const kept = existing.get(unitId(resource.name, part));
              if (!kept?.value.trim() || groups.get(groupKey(resource.kind, resource.name))?.items.has(part)) continue;
              place(resource.name, resource.kind, part, resource.attrs.formatted, kept.raw);
            }
          }

          const ofKind = (kind: Group['kind']): Group[] =>
            [...groups.values()].filter((group) => group.kind === kind).sort((a, b) => byCodePoint(a.name, b.name));
          const lines: string[] = [];
          for (const group of ofKind('string-array')) {
            lines.push(`  <string-array name="${group.name}"${attrString({ formatted: group.formatted })}>`);
            for (const [, xml] of [...group.items].sort(([a], [b]) => Number(a) - Number(b))) lines.push(`    <item>${xml}</item>`);
            lines.push('  </string-array>');
          }
          for (const group of ofKind('string')) {
            lines.push(`  <string name="${group.name}"${attrString({ formatted: group.formatted })}>${group.items.get('')}</string>`);
          }
          for (const group of ofKind('plurals')) {
            lines.push(`  <plurals name="${group.name}"${attrString({ formatted: group.formatted })}>`);
            for (const [quantity, xml] of [...group.items].sort(
              ([a], [b]) => PLURAL_ORDER.indexOf(String(a)) - PLURAL_ORDER.indexOf(String(b)),
            )) {
              lines.push(`    <item quantity="${quantity}">${xml}</item>`);
            }
            lines.push('  </plurals>');
          }
          if (lines.length === 0) continue;

          const xml = [
            '<?xml version="1.0" encoding="utf-8"?>',
            '<resources xmlns:xliff="urn:oasis:names:tc:xliff:document:1.2">',
            ...lines,
            '</resources>',
            '',
          ].join('\n');
          await writeText(options.root, localePath, xml);
          files.push(localePath);
          written += groups.size;
        }
      }
      return { written, files };
    },
  };
};
