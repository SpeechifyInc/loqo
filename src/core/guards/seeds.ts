import type { ValueContext } from '../model/types';
import type { GuardSeed, SeedOutcome, SeedResult } from './definition';
import { type GuardAnswer, loadGuard, quickjsEngine, type Result } from './sandbox';

const outcomeOf = (result: Result<GuardAnswer>): SeedOutcome => {
  if (!result.ok) return { kind: 'error', error: result.error };
  const answer = result.value;
  if (answer === null) return { kind: 'pass' };
  if (typeof answer === 'string') return { kind: 'reject', reason: answer };
  return { kind: 'fix', value: answer.fix, reason: answer.reason };
};

const matches = (seed: GuardSeed, actual: SeedOutcome): boolean =>
  actual.kind === seed.expect && (actual.kind !== 'fix' || seed.fixed === null || actual.value === seed.fixed);

/** Runs guard code over its seeds in one sandbox; code that does not load fails every seed with the load error. */
export const runSeeds = async (code: string, seeds: GuardSeed[], base: Pick<ValueContext, 'projectSlug' | 'sourceLocale'>): Promise<SeedResult[]> => {
  const judge = (seed: GuardSeed, actual: SeedOutcome): SeedResult => ({ ...seed, actual, ok: matches(seed, actual) });
  const loaded = loadGuard(await quickjsEngine(), code);
  if (!loaded.ok) return seeds.map((seed) => judge(seed, { kind: 'error', error: loaded.error }));
  using guard = loaded.value;
  return seeds.map((seed) => {
    const ctx: ValueContext = { ...base, locale: seed.locale, key: seed.key, tags: seed.tags, meta: seed.meta };
    return judge(seed, outcomeOf(guard.run(seed.candidate, seed.source, ctx)));
  });
};
