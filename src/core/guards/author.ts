import { generateObject, type ModelMessage } from 'ai';
import { z } from 'zod';
import { languageModelOf, type ModelClient } from '../pipeline/llm';
import { type AuthoredGuard, GUARD_LIMITS, type GuardAuthorInput, type GuardSeed, type SeedResult } from './definition';
import { runSeeds } from './seeds';

/** Writing a guard is code generation; the strongest coding model is worth its cost for a call per guard. */
export const DEFAULT_AUTHOR_MODEL = 'anthropic:claude-opus-5-5';

/** Generations per brief: the first draft plus two rounds of feedback from its own seeds. */
export const AUTHOR_ATTEMPTS = 3;

const SEEDS = { min: 3, max: 5 } as const;

/** No numeric or length bounds: providers' structured output does not enforce them all; they are checked here instead. */
const AUTHORED = z.object({
  code: z.string().describe('The guard module, TypeScript'),
  repairPrompt: z.string().nullable().describe('System prompt for a model to fix a rejected value; null when code fixes or rejects everything'),
  repairAttempts: z.number().int().nullable().describe('Repair calls per value, 1 to 5; null for 1'),
  seeds: z
    .array(
      z.object({
        note: z.string().describe('What this seed checks, a few words'),
        source: z.string(),
        candidate: z.string().describe('The translation the guard judges'),
        locale: z.string(),
        key: z.string(),
        tags: z.array(z.string()),
        metaJson: z.string().describe('The resource meta as a JSON object; "{}" when none'),
        expect: z.enum(['pass', 'reject', 'fix']),
        fixed: z.string().nullable().describe('For expect "fix": the exact value the fix must produce; otherwise null'),
      }),
    )
    .describe(`${SEEDS.min} to ${SEEDS.max} samples`),
});

type Authored = z.infer<typeof AUTHORED>;

const SYSTEM = `You write guards for a translation pipeline. Every machine translation of a resource passes through each guard of its scenario before it is saved.

## The module
One TypeScript module whose default export is a pure, synchronous function:

export default (candidate: string, source: string, ctx: { projectSlug: string; sourceLocale: string; locale: string; key: string; tags: string[]; meta: Record<string, unknown> }) =>
  null | string | { fix: string; reason?: string }

- null: the candidate is fine.
- a string: reject the candidate; the string is the reason, one short sentence naming what is wrong.
- { fix, reason }: replace the candidate with fix. Use it only when the correct value follows mechanically from the candidate and the source (restore a dropped trailing colon, unwrap stray quotes, normalize a spacing rule). Never guess words.
- Return null for values the guard is not about: check ctx.tags or ctx.locale inside the code when the rule applies to some resources only.

It runs in QuickJS: the language only. No imports, require, fetch, timers, Intl, process or Node APIs. ${GUARD_LIMITS.callMs} ms and ${GUARD_LIMITS.memoryBytes / 1024 / 1024} MB per value, so no catastrophic-backtracking regexes. Never throw on odd input: a guard that throws rejects the value with no repair.

## Repair prompt
When a rejected value needs language judgement to fix (a dropped placeholder, a mistranslated term, too long for the UI), write a repair prompt: the system prompt for a model that receives the rejected translation and must return a corrected one. Variables filled in: {{reason}}, {{locale}}, {{sourceLocale}}, {{key}}, {{source}}, {{meta.<field>}}. Keep it short and specific to the rule. Use null when the code fixes or the rejection must be final.

## Seeds
${SEEDS.min} to ${SEEDS.max} realistic samples the guard is run on to prove it works: at least one that passes and at least one that it rejects or fixes. Use the project's locales and the scenario's tags. For a fix, give the exact value it must produce.`;

type Project = { slug: string; sourceLocale: string; targetLocales: string[] };

const briefMessage = (input: GuardAuthorInput, project: Project, tags: string[]): string =>
  [
    input.name ? `Guard name: ${input.name}` : null,
    input.description ? `Description: ${input.description}` : null,
    `Source locale: ${project.sourceLocale}. Target locales: ${project.targetLocales.join(', ') || 'none yet'}.`,
    `Scenario tags (every resource of the scenario carries them): ${tags.join(', ') || 'none; the scenario covers every resource'}.`,
    '',
    'What the guard must catch, and what good values look like:',
    input.brief,
  ]
    .filter((line) => line !== null)
    .join('\n');

const parseMeta = (json: string): Record<string, unknown> | null => {
  try {
    const meta: unknown = JSON.parse(json || '{}');
    return typeof meta === 'object' && meta !== null && !Array.isArray(meta) ? (meta as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const seedsOf = (authored: Authored): { seeds: GuardSeed[]; problems: string[] } => {
  const problems: string[] = [];
  const seeds = authored.seeds.slice(0, SEEDS.max).map(({ metaJson, ...seed }): GuardSeed => {
    const meta = parseMeta(metaJson);
    if (!meta) problems.push(`seed "${seed.note}": metaJson is not a JSON object`);
    return { ...seed, fixed: seed.expect === 'fix' ? seed.fixed : null, meta: meta ?? {} };
  });
  if (authored.seeds.length < SEEDS.min || authored.seeds.length > SEEDS.max) problems.push(`give ${SEEDS.min} to ${SEEDS.max} seeds, not ${authored.seeds.length}`);
  if (!seeds.some((seed) => seed.expect === 'pass')) problems.push('add a seed the guard passes');
  if (!seeds.some((seed) => seed.expect !== 'pass')) problems.push('add a seed the guard rejects or fixes');
  return { seeds, problems };
};

const describeOutcome = (result: SeedResult): string => {
  const { actual } = result;
  if (actual.kind === 'error') return `the guard failed: ${actual.error}`;
  if (actual.kind === 'reject') return `it rejected: ${actual.reason}`;
  if (actual.kind === 'fix') return `it fixed to ${JSON.stringify(actual.value)}`;
  return 'it passed';
};

const mismatchOf = (result: SeedResult): string => {
  const expected = result.expect === 'fix' && result.fixed !== null ? `a fix to ${JSON.stringify(result.fixed)}` : result.expect;
  return `seed "${result.note}": expected ${expected}, but ${describeOutcome(result)}`;
};

const clampAttempts = (attempts: number | null): number | undefined => (attempts === null || attempts <= 1 ? undefined : Math.min(attempts, 5));

type Deps = { models: ModelClient; model: string };

/**
 * Asks a model for guard code, a repair prompt and seeds, runs the code on the seeds, and sends
 * whatever went wrong back for another try. The last draft is returned either way, its seed
 * results showing what still fails.
 */
export const authorGuard = async ({ models, model }: Deps, input: GuardAuthorInput, project: Project, tags: string[]): Promise<AuthoredGuard> => {
  const attempt = async (attempts: number, messages: ModelMessage[]): Promise<AuthoredGuard> => {
    const { object } = await generateObject({
      model: languageModelOf(models, model),
      schema: AUTHORED,
      schemaName: 'guard',
      system: SYSTEM,
      messages,
      maxRetries: models.backoff.maxRetries,
    });
    const { seeds, problems } = seedsOf(object);
    const results = await runSeeds(object.code, seeds, { projectSlug: project.slug, sourceLocale: project.sourceLocale });
    const repairPrompt = object.repairPrompt?.trim();
    const repairAttempts = clampAttempts(object.repairAttempts);
    const authored: AuthoredGuard = {
      code: object.code,
      repair: repairPrompt ? { prompt: repairPrompt, ...(repairAttempts ? { attempts: repairAttempts } : {}) } : null,
      seeds: results,
      attempts,
      model,
    };
    const failures = [...problems, ...results.filter((result) => !result.ok).map(mismatchOf)];
    if (failures.length === 0 || attempts >= AUTHOR_ATTEMPTS) return authored;
    const feedback = `Running your guard on your seeds found problems. Fix the code (or a seed, if the seed is what is wrong) and answer again in full:\n- ${failures.join('\n- ')}`;
    return attempt(attempts + 1, [...messages, { role: 'assistant', content: JSON.stringify(object) }, { role: 'user', content: feedback }]);
  };

  return attempt(1, [{ role: 'user', content: briefMessage(input, project, tags) }]);
};
