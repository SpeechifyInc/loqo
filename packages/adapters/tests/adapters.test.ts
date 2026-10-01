import { describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type PulledResource, pluralCategories, type PushResource, pulledTarget } from '@loqo/sdk';
import { androidXml, parseAndroidResources } from '../src/android-xml';
import { compositeKey, discoverFiles, globToRegExp } from '../src/files';
import { json } from '../src/json';
import { xcstrings } from '../src/xcstrings';

const fixtures = join(import.meta.dir, 'fixtures');
const scratch = () => mkdtemp(join(tmpdir(), 'loqo-'));

describe('file discovery', () => {
  test('globs: ** spans directories, * stays inside a segment', () => {
    const catalog = globToRegExp('**/*.xcstrings');
    expect(catalog.test('Localizable.xcstrings')).toBe(true);
    expect(catalog.test('App/Resources/Localizable.xcstrings')).toBe(true);
    expect(catalog.test('App/Localizable.xcstrings.bak')).toBe(false);
    const strings = globToRegExp('**/values/strings.xml');
    expect(strings.test('app/src/main/res/values/strings.xml')).toBe(true);
    expect(strings.test('app/src/main/res/values-de/strings.xml')).toBe(false);
    expect(globToRegExp('src/*/en.json').test('src/a/b/en.json')).toBe(false);
  });

  test('walks the tree but never node_modules, .git or an ignored prefix', async () => {
    const root = await scratch();
    for (const path of ['App/Localizable.xcstrings', 'Tools/Localizable.xcstrings', 'node_modules/x/Localizable.xcstrings', '.git/Localizable.xcstrings']) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), '{}');
    }
    expect(await discoverFiles({ root, include: ['**/*.xcstrings'], ignore: ['Tools'] })).toEqual(['App/Localizable.xcstrings']);
  });
});

describe('xcstrings adapter', () => {
  const project = { slug: 'ios', name: 'iOS', sourceLocale: 'en', targetLocales: ['de', 'pl'] };

  test('pull: one resource per key or plural variant, placeholder-only keys dropped, legacy targets kept', async () => {
    const { resources } = await xcstrings({ root: fixtures }).pull!({ project });
    const keys = resources.map((r) => JSON.parse(r.key).key);
    expect(keys).not.toContain('%@');
    expect(resources.find((r) => JSON.parse(r.key).quantity === 'one')).toMatchObject({
      source: '%lld item',
      tags: ['ios', 'plural'],
      meta: { filePath: 'Localizable.xcstrings', key: '%lld items', quantity: 'one', comment: 'Library count', pluralSpecifiers: ['%lld'] },
      targets: { de: '%lld Element' },
    });
    expect(resources.find((r) => r.source === 'Hello')?.targets).toEqual({ de: 'Hallo' });
    expect(resources.find((r) => r.source === 'Acme')?.translatable).toBe(false);
  });

  test('push: unchanged values leave the file byte-identical, a new value is a minimal edit', async () => {
    const root = await scratch();
    await cp(join(fixtures, 'Localizable.xcstrings'), join(root, 'Localizable.xcstrings'));
    const adapter = xcstrings({ root });
    const original = await Bun.file(join(root, 'Localizable.xcstrings')).text();
    const { resources } = await adapter.pull!({ project });
    const asPush = resources.map((r) => ({
      ...r,
      tags: r.tags ?? [],
      meta: r.meta ?? {},
      translatable: r.translatable ?? true,
      targets: Object.fromEntries(
        Object.entries(r.targets ?? {}).map(([locale, value]) => [locale, { value: pulledTarget(value).value ?? '', status: 'translated', origin: 'legacy', pinned: false, native: false }]),
      ),
    }));
    expect(await adapter.push!({ project }, asPush)).toEqual({ written: 0, files: [] });
    expect(await Bun.file(join(root, 'Localizable.xcstrings')).text()).toBe(original);

    const hello = asPush.find((r) => r.source === 'Hello')!;
    hello.targets.pl = { value: 'Cześć', status: 'translated', origin: 'machine', pinned: false, native: false };
    expect((await adapter.push!({ project }, [hello])).written).toBe(1);
    const after = (await adapter.pull!({ project })).resources.find((r) => r.source === 'Hello');
    expect(after?.targets).toEqual({ de: 'Hallo', pl: 'Cześć' });
  });
});

describe('android adapter', () => {
  const project = { slug: 'android', name: 'Android', sourceLocale: 'en', targetLocales: ['de', 'pl'] };
  const root = join(fixtures, 'android');

  test('parses strings, arrays, plurals and skips comments', async () => {
    const file = 'app/src/main/res/values/strings.xml';
    const parsed = parseAndroidResources(await Bun.file(join(root, file)).text(), file);
    expect(parsed.map((r) => `${r.kind}:${r.name}`)).toEqual([
      'string:app_name',
      'string:quoted',
      'string:with_xliff',
      'string:cdata',
      'string-array:voices',
      'plurals:pages',
    ]);
  });

  test('pull: translatable flag, aapt quotes unwrapped, synthesized plural categories for target locales', async () => {
    const { resources } = await androidXml({ root }).pull!({ project });
    const byKey = Object.fromEntries(resources.map((r) => [r.key, r]));
    const file = 'app/src/main/res/values/strings.xml';
    expect(resources.map((r) => JSON.parse(r.key).key)).not.toContain('commented_out');
    expect(byKey[compositeKey({ filePath: file, key: 'app_name' })]?.translatable).toBe(false);
    expect(byKey[compositeKey({ filePath: file, key: 'quoted' })]?.source).toBe('  Padded  ');
    expect(byKey[compositeKey({ filePath: file, key: 'with_xliff' })]?.source).toBe('Moved <xliff:g id="count" example="5">%1$d</xliff:g> files');
    expect(byKey[compositeKey({ filePath: file, key: 'with_xliff' })]?.targets).toEqual({ de: 'Verschoben <xliff:g id="count" example="5">%1$d</xliff:g> Dateien \\"fett\\"' });
    expect(byKey[compositeKey({ filePath: file, key: 'voices', index: 1 })]?.source).toBe('Spanish');
    // Polish needs few/many; they are seeded from `other`, never from `one`.
    const few = byKey[compositeKey({ filePath: file, key: 'pages', quantity: 'few' })];
    expect(few).toMatchObject({ source: '%1$d pages', tags: ['android', 'plural', 'synthesized'], meta: { quantity: 'few', pluralSpecifiers: ['%1$d'] } });
  });

  test('push: writes values-<locale> files with escaping rules and only the locale\'s plural categories', async () => {
    const dir = await scratch();
    await cp(root, dir, { recursive: true });
    const adapter = androidXml({ root: dir });
    const { resources } = await adapter.pull!({ project });
    const target = (value: string) => ({ value, status: 'translated', origin: 'machine', pinned: false, native: false });
    const pushed = resources.map((r) => {
      const parsed = JSON.parse(r.key) as { key: string; quantity?: string; index?: number };
      const value =
        parsed.key === 'quoted' ? "  Gepolstert  " :
        parsed.key === 'with_xliff' ? 'Verschoben <xliff:g id="count" example="5">%1$d</xliff:g> Dateien <b>fett</b> 5 < 6' :
        parsed.key === 'cdata' ? '<![CDATA[<font>Fett</font> & Text]]>' :
        parsed.key === 'pages' ? `${parsed.quantity} %1$d Seiten` :
        parsed.key === 'voices' ? `Stimme ${parsed.index}` : 'x';
      return { ...r, tags: r.tags ?? [], meta: r.meta ?? {}, translatable: r.translatable ?? true, targets: { de: target(value), pl: target(value) } };
    });
    const result = await adapter.push!({ project }, pushed);
    expect(result.files).toEqual(['app/src/main/res/values-de/strings.xml', 'app/src/main/res/values-pl/strings.xml']);
    const de = await Bun.file(join(dir, 'app/src/main/res/values-de/strings.xml')).text();
    expect(de).not.toContain('app_name');
    expect(de).toContain('<string name="quoted">"  Gepolstert  "</string>');
    expect(de).toContain('<string name="with_xliff">"Verschoben <xliff:g id="count" example="5">%1$d</xliff:g> Dateien <b>fett</b> 5 &lt; 6"</string>');
    expect(de).toContain('<string name="cdata">"<![CDATA[<font>Fett</font> & Text]]>"</string>');
    expect(de).toContain('<string-array name="voices">\n    <item>"Stimme 0"</item>\n    <item>"Stimme 1"</item>');
    expect(de).toMatch(/<plurals name="pages">\n {4}<item quantity="one">"one %1\$d Seiten"<\/item>\n {4}<item quantity="other">"other %1\$d Seiten"<\/item>\n {2}<\/plurals>/);
    const pl = await Bun.file(join(dir, 'app/src/main/res/values-pl/strings.xml')).text();
    expect(pl).toContain('quantity="few"');
    expect(pl).toContain('quantity="many"');
    expect(de).not.toContain('quantity="few"');
  });

  test('push: an unchanged value is written back with its aapt quoting as the file had it', async () => {
    const dir = await scratch();
    await cp(root, dir, { recursive: true });
    const adapter = androidXml({ root: dir });
    await adapter.push!({ project }, translated((await adapter.pull!({ project })).resources));
    const de = await Bun.file(join(dir, 'app/src/main/res/values-de/strings.xml')).text();
    expect(de).toContain('<string name="with_xliff">"Verschoben "<xliff:g id="count" example="5">"%1$d"</xliff:g>" Dateien \\"fett\\""</string>');
  });
});

/** What `GET /translations` hands back: every pulled value as translated, except the ones `rejected` holds back. */
const translated = (pulled: PulledResource[], rejected: (key: string, locale: string) => boolean = () => false): PushResource[] =>
  pulled.map((resource) => ({
    key: resource.key,
    source: resource.source,
    tags: resource.tags ?? [],
    meta: resource.meta ?? {},
    translatable: resource.translatable ?? true,
    targets: Object.fromEntries(
      Object.entries(resource.targets ?? {})
        .filter(([locale]) => !rejected(resource.key, locale))
        .map(([locale, target]) => [locale, { value: pulledTarget(target).value ?? '', status: 'translated', origin: 'legacy', pinned: false, native: false }]),
    ),
  }));

describe('android adapter: composeResources', () => {
  const project = { slug: 'kmp', name: 'KMP', sourceLocale: 'en', targetLocales: ['he', 'ru', 'ar'] };
  const localeMap = { he: 'iw' };
  const fixture = join(fixtures, 'compose');
  const dir = 'feature/x/src/commonMain/composeResources';
  const localeFiles = ['values-iw/strings.xml', 'values-iw/plurals.xml', 'values-ru/plurals.xml', 'values-ar/strings.xml', 'values-ar/plurals.xml'];
  const keyOf = (file: string, key: string, quantity?: string) => compositeKey({ filePath: `${dir}/values/${file}`, key, quantity });

  const pulledFixture = async () => {
    const { resources } = await androidXml({ root: fixture, localeMap }).pull!({ project });
    return new Map(resources.map((resource) => [resource.key, resource]));
  };

  /** Pulls a copy of the fixture, pushes `edit(pulled)` back and returns the locale files before and after. */
  const roundTrip = async (edit: (pulled: PulledResource[]) => PushResource[]) => {
    const root = await scratch();
    await cp(fixture, root, { recursive: true });
    const adapter = androidXml({ root, localeMap });
    const read = async () => Object.fromEntries(await Promise.all(localeFiles.map(async (file) => [file, await Bun.file(join(root, dir, file)).text()] as const)));
    const before = await read();
    await adapter.push!({ project }, edit((await adapter.pull!({ project })).resources));
    return { before, after: await read() };
  };

  test('pull: a `"` is a literal character, in the source and in existing translations', async () => {
    const pulled = await pulledFixture();
    expect(pulled.get(keyOf('strings.xml', 'search_empty_message'))).toMatchObject({
      source: 'No results found for "%1$s"',
      targets: { he: 'לא נמצאו תוצאות עבור "%1$s"' },
    });
    expect(pulled.get(keyOf('strings.xml', 'error_email_invalid'))?.targets).toEqual({ he: 'נא להזין כתובת דוא"ל תקינה' });
  });

  test('pull: an xliff wrapper the source lacks is dropped, leaving the placeholders to compare', async () => {
    const pulled = await pulledFixture();
    expect(pulled.get(keyOf('plurals.xml', 'ai_chat_message_chapters', 'few'))?.targets?.ru).toBe('%1$d глав');
    expect(pulled.get(keyOf('plurals.xml', 'ai_chat_quiz_chapters', 'zero'))?.targets?.ar).toBe('اختبار · %1$d فصول');
    expect(pulled.get(keyOf('strings.xml', 'import_scan_limit_reached'))?.targets?.ar).toBe('يمكنك استيراد ما يصل إلى %1$d صفحة دفعة واحدة');
  });

  test('pull: a plural variant without a placeholder reaches the platform as written', async () => {
    const pulled = await pulledFixture();
    expect(pulled.get(keyOf('plurals.xml', 'hours_ago', 'one'))).toMatchObject({ targets: { he: 'לפני שעה' }, meta: { quantity: 'one', pluralSpecifiers: ['%1$s'] } });
    expect(pulled.get(keyOf('plurals.xml', 'hours_ago', 'two'))).toMatchObject({ source: '%1$s hours ago', targets: { he: 'לפני שעתיים' } });
  });

  test('pull then push leaves every existing translation byte for byte', async () => {
    const { before, after } = await roundTrip((pulled) => translated(pulled));
    expect(after).toEqual(before);
  });

  test('push: a value the platform holds back stays in the file, and every plural category the locale needs survives', async () => {
    const heldBack = new Set([keyOf('plurals.xml', 'ai_chat_message_chapters', 'few'), keyOf('plurals.xml', 'ai_chat_quiz_chapters', 'many')]);
    const { before, after } = await roundTrip((pulled) =>
      translated(pulled, (key, locale) => heldBack.has(key) || (locale === 'ar' && key.includes('"ai_chat_quiz_chapters"'))),
    );
    expect(after).toEqual(before);
    for (const [file, locale] of [['values-ru/plurals.xml', 'ru'], ['values-ar/plurals.xml', 'ar']] as const) {
      for (const plural of parseAndroidResources(after[file] ?? '', `${dir}/${file}`)) {
        expect(plural.kind === 'plurals' && plural.items.map((item) => item.quantity)).toEqual([...pluralCategories(locale)]);
      }
    }
  });

  test('push: a replaced value is escaped for Compose, its neighbours stay as they were', async () => {
    const replaced = keyOf('plurals.xml', 'ai_chat_message_chapters', 'many');
    const { before, after } = await roundTrip((pulled) =>
      translated(pulled).map((resource) =>
        resource.key === replaced ? { ...resource, targets: { ...resource.targets, ru: { ...resource.targets.ru!, value: '%1$d "глав" & 5 < 6' } } } : resource,
      ),
    );
    expect(after['values-ru/plurals.xml']).toBe(
      (before['values-ru/plurals.xml'] ?? '').replace('<item quantity="many">%1$d главы</item>', '<item quantity="many">%1$d "глав" &amp; 5 &lt; 6</item>'),
    );
  });
});

describe('json adapter', () => {
  const project = { slug: 'webapp', name: 'Webapp', sourceLocale: 'en', targetLocales: ['de', 'zh-hans'] };
  const adapterAt = (root: string) =>
    json({ root, source: 'public/locales/en/common.json', target: 'public/locales/{locale}/common.json', localeMap: { 'zh-hans': 'zh-Hans' } });

  const target = (value: string) => ({ value, status: 'translated', origin: 'machine', pinned: false, native: false });

  const bundle = async (root: string, locale: string, data: Record<string, string>) => {
    await mkdir(join(root, `public/locales/${locale}`), { recursive: true });
    await writeFile(join(root, `public/locales/${locale}/common.json`), JSON.stringify(data, null, 2));
  };

  test('pull: one resource per source key, carrying what the locale files already say', async () => {
    const root = await scratch();
    await bundle(root, 'en', { Zebra: 'Zebra', apple: 'apple' });
    await bundle(root, 'de', { apple: 'Apfel', gone: 'Weg' });
    const { resources } = await adapterAt(root).pull!({ project });
    expect(resources).toEqual([
      { key: 'Zebra', source: 'Zebra', tags: ['webapp'], meta: {}, targets: {} },
      { key: 'apple', source: 'apple', tags: ['webapp'], meta: {}, targets: { de: 'Apfel' } },
    ]);
  });

  test('push: keys stay in codepoint order, untranslated keys survive, the locale map picks the file', async () => {
    const root = await scratch();
    await bundle(root, 'en', { Zebra: 'Zebra', apple: 'apple' });
    await bundle(root, 'de', { kept: 'Behalten' });
    const resources: PushResource[] = [
      { key: 'apple', source: 'apple', tags: ['webapp'], meta: {}, translatable: true, targets: { de: target('Apfel'), 'zh-hans': target('苹果') } },
      { key: 'Zebra', source: 'Zebra', tags: ['webapp'], meta: {}, translatable: true, targets: { de: target('Zebra') } },
    ];
    expect(await adapterAt(root).push!({ project }, resources)).toEqual({
      written: 3,
      files: ['public/locales/de/common.json', 'public/locales/zh-Hans/common.json'],
    });
    expect(await Bun.file(join(root, 'public/locales/de/common.json')).text()).toBe('{\n  "Zebra": "Zebra",\n  "apple": "Apfel",\n  "kept": "Behalten"\n}\n');
    expect(await Bun.file(join(root, 'public/locales/zh-Hans/common.json')).text()).toBe('{\n  "apple": "苹果"\n}\n');
  });

  test("push: `preserve` keeps the file's own order and appends what the source adds", async () => {
    const root = await scratch();
    await bundle(root, 'en', { zulu: 'zulu', alpha: 'alpha' });
    await bundle(root, 'de', { zulu: 'Zulu', kept: 'Behalten' });
    const adapter = json({ root, source: 'public/locales/en/common.json', target: 'public/locales/{locale}/common.json', sort: 'preserve' });
    const resources: PushResource[] = [
      { key: 'alpha', source: 'alpha', tags: ['webapp'], meta: {}, translatable: true, targets: { de: target('Alpha') } },
      { key: 'zulu', source: 'zulu', tags: ['webapp'], meta: {}, translatable: true, targets: { de: target('Zulu') } },
    ];
    await adapter.push!({ project: { ...project, targetLocales: ['de'] } }, resources);
    expect(await Bun.file(join(root, 'public/locales/de/common.json')).text()).toBe('{\n  "zulu": "Zulu",\n  "kept": "Behalten",\n  "alpha": "Alpha"\n}\n');
  });
});
