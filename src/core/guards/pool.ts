import type { GuardRow } from '../../db/schema';
import { compileTemplate } from '../prompts/template';
import { loadGuard, quickjsEngine, type Result, type SandboxedGuard } from './sandbox';
import type { Guard } from './types';

/**
 * The sandboxes one batch of work needs, loaded on first use and freed together when the batch
 * ends (`using pool = await createGuardPool()`). Rows do not change within a batch.
 */
export type GuardPool = Disposable & {
  guard(row: GuardRow): Guard;
  /** Why the row's code does not load, or `null` when it does. */
  loadError(row: GuardRow): string | null;
};

export const createGuardPool = async (): Promise<GuardPool> => {
  const quickjs = await quickjsEngine();
  const loaded = new Map<string, Result<SandboxedGuard>>();
  const load = (row: GuardRow): Result<SandboxedGuard> => {
    const cached = loaded.get(row.id);
    if (cached) return cached;
    const fresh = loadGuard(quickjs, row.code);
    loaded.set(row.id, fresh);
    return fresh;
  };

  const guard = (row: GuardRow): Guard => {
    const render = row.repair ? compileTemplate(row.repair.prompt) : null;
    return {
      name: row.name,
      // A guard that does not load or run fails closed: the value is rejected, and no model is asked to fix it.
      check: (candidate, source, ctx) => {
        const sandbox = load(row);
        if (!sandbox.ok) return { kind: 'reject', reason: `guard does not load: ${sandbox.error}`, repairable: false };
        const result = sandbox.value.run(candidate, source, ctx);
        if (!result.ok) return { kind: 'reject', reason: `guard failed: ${result.error}`, repairable: false };
        const answer = result.value;
        if (answer === null) return null;
        if (typeof answer === 'string') return { kind: 'reject', reason: answer, repairable: true };
        return { kind: 'fix', value: answer.fix, reason: answer.reason };
      },
      ...(render ? { repair: (source, ctx, reason) => render({ reason, source, locale: ctx.locale, sourceLocale: ctx.sourceLocale, key: ctx.key, meta: ctx.meta }) } : {}),
      repairAttempts: row.repair?.attempts ?? 1,
    };
  };

  return {
    guard,
    loadError: (row) => {
      const sandbox = load(row);
      return sandbox.ok ? null : sandbox.error;
    },
    [Symbol.dispose]: () => {
      for (const sandbox of loaded.values()) if (sandbox.ok) sandbox.value[Symbol.dispose]();
      loaded.clear();
    },
  };
};
