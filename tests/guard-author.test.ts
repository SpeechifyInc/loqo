import { describe, expect, test } from 'bun:test';
import { createProviderRegistry } from 'ai';
import { MockLanguageModelV4, MockProviderV4 } from 'ai/test';
import type { ResolvedConfig } from '../src/config';
import { AUTHOR_ATTEMPTS, authorGuard, type GuardSeed, runSeeds } from '../src/core/guards';
import { createProviderBackoff } from '../src/core/pipeline/backoff';

type Draft = { code: string; repairPrompt?: string | null; repairAttempts?: number | null; seeds: (Omit<GuardSeed, 'meta'> & { metaJson?: string })[] };

const seed = (overrides: Partial<Draft['seeds'][number]> & Pick<GuardSeed, 'candidate' | 'expect'>): Draft['seeds'][number] => ({
  note: overrides.candidate,
  source: 'Name:',
  locale: 'de',
  key: 'form.name',
  tags: [],
  fixed: null,
  ...overrides,
});

const COLON = `export default (candidate: string, source: string) =>
  source.endsWith(':') && !candidate.endsWith(':') ? { fix: candidate + ':', reason: 'restored the colon' } : null;`;

/** A model that answers each call with the next draft, and remembers the conversations it was sent. */
const scripted = (drafts: Draft[]) => {
  const conversations: string[][] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      conversations.push(prompt.flatMap((message) => (message.role === 'system' ? [message.content] : message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])))));
      const draft = drafts[Math.min(conversations.length - 1, drafts.length - 1)];
      const answer = { repairPrompt: null, repairAttempts: null, ...draft, seeds: draft?.seeds.map((item) => ({ metaJson: '{}', ...item })) };
      return {
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } },
        warnings: [],
      };
    },
  });
  const providers = createProviderRegistry({ fake: new MockProviderV4({ languageModels: { author: model } }) }) as ResolvedConfig['providers'];
  return { deps: { models: { providers, backoff: createProviderBackoff() }, model: 'fake:author' }, conversations };
};

const project = { slug: 'app', sourceLocale: 'en', targetLocales: ['de', 'fr'] };

describe('runSeeds', () => {
  test('judges each seed by outcome, and a fix by its exact value when one is given', async () => {
    const results = await runSeeds(
      COLON,
      [
        { ...seed({ candidate: 'Name:', expect: 'pass' }), meta: {} },
        { ...seed({ candidate: 'Name', expect: 'fix', fixed: 'Name:' }), meta: {} },
        { ...seed({ candidate: 'Name', expect: 'fix', fixed: 'Name :' }), meta: {} },
        { ...seed({ candidate: 'Name', expect: 'reject' }), meta: {} },
      ],
      { projectSlug: 'app', sourceLocale: 'en' },
    );
    expect(results.map((result) => [result.actual.kind, result.ok])).toEqual([
      ['pass', true],
      ['fix', true],
      ['fix', false],
      ['fix', false],
    ]);
  });

  test('code that does not load fails every seed with the load error', async () => {
    const results = await runSeeds('export default (', [{ ...seed({ candidate: 'a', expect: 'pass' }), meta: {} }], { projectSlug: 'app', sourceLocale: 'en' });
    expect(results[0]?.actual).toMatchObject({ kind: 'error', error: expect.stringMatching(/^does not compile/) });
    expect(results[0]?.ok).toBe(false);
  });
});

describe('authorGuard', () => {
  test('sends failing seeds back to the model and returns the draft that passes them', async () => {
    const seeds = [seed({ candidate: 'Name:', expect: 'pass' }), seed({ candidate: 'Name', expect: 'fix', fixed: 'Name:' }), seed({ candidate: 'Vorname:', expect: 'pass' })];
    const { deps, conversations } = scripted([{ code: 'export default () => null', seeds }, { code: COLON, repairPrompt: '  ', repairAttempts: 9, seeds }]);

    const authored = await authorGuard(deps, { brief: 'Labels ending in a colon keep it' }, project, ['forms']);

    expect(authored.attempts).toBe(2);
    expect(authored.code).toBe(COLON);
    expect(authored.repair).toBeNull();
    expect(authored.seeds.every((result) => result.ok)).toBe(true);
    expect(conversations[0]?.join('\n')).toContain('Scenario tags (every resource of the scenario carries them): forms');
    expect(conversations[1]?.at(-1)).toContain('seed "Name": expected a fix to "Name:", but it passed');
  });

  test('stops after the last attempt and returns what still fails, with a clamped repair', async () => {
    const { deps, conversations } = scripted([
      { code: 'export default (', repairPrompt: 'Restore the colon. {{reason}}', repairAttempts: 9, seeds: [seed({ candidate: 'Name', expect: 'fix', metaJson: '[1]' })] },
    ]);

    const authored = await authorGuard(deps, { brief: 'Labels keep their colon' }, project, []);

    expect(authored.attempts).toBe(AUTHOR_ATTEMPTS);
    expect(conversations).toHaveLength(AUTHOR_ATTEMPTS);
    expect(authored.repair).toEqual({ prompt: 'Restore the colon. {{reason}}', attempts: 5 });
    expect(authored.seeds[0]).toMatchObject({ ok: false, meta: {}, actual: { kind: 'error' } });
    const feedback = conversations[1]?.at(-1) ?? '';
    expect(feedback).toContain('metaJson is not a JSON object');
    expect(feedback).toContain('give 3 to 5 seeds, not 1');
    expect(feedback).toContain('add a seed the guard passes');
    expect(feedback).toContain('the guard failed: does not compile');
  });
});
