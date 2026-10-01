import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { isPlaceholderOnlyKey } from '@loqo/sdk';
import { createGuardPool, type GuardPool, type GuardRepair, tryGuard } from '../src/core/guards';
import type { ValueContext } from '../src/core/model/types';
import type { GuardRow } from '../src/db/schema';

const ctx = (over: Partial<ValueContext> = {}): ValueContext => ({ projectSlug: 'p', sourceLocale: 'en', locale: 'pl', key: 'k', tags: [], meta: {}, ...over });

const now = new Date();
let pool: GuardPool;
let rows = 0;

/** The pool caches by row id, so every guard under test gets a fresh one. */
const guard = (code: string, repair: GuardRepair | null = null) => {
  rows += 1;
  const row: GuardRow = { id: `g${rows}`, scenarioId: 's', name: `g${rows}`, description: null, brief: null, code, repair, enabled: true, createdAt: now, updatedAt: now };
  return pool.guard(row);
};

beforeAll(async () => {
  pool = await createGuardPool();
});

afterAll(() => {
  pool[Symbol.dispose]();
});

describe('guard code', () => {
  test('a TypeScript guard sees the candidate, the source and the context', () => {
    const cap = guard(`
      type Ctx = { locale: string; meta: { maxLength?: number } };
      export default (candidate: string, _source: string, ctx: Ctx): string | null =>
        ctx.meta.maxLength !== undefined && candidate.length > ctx.meta.maxLength ? 'too long for ' + ctx.locale : null;
    `);
    expect(cap.check('Hallo Welt', 'Hello', ctx({ meta: { maxLength: 5 } }))).toEqual({ kind: 'reject', reason: 'too long for pl', repairable: true });
    expect(cap.check('Hallo', 'Hello', ctx({ meta: { maxLength: 5 } }))).toBeNull();
    expect(guard(`export default () => ''`).check('a', 'b', ctx())).toBeNull();
  });

  test('a real rule reads like the code it replaces', () => {
    const placeholders = guard(`
      const SPECIFIER = /%%|%(?:\\d+\\$)?(?:@|lld|llu|ld|lu|lf|zu|d|u|f|s|c)/g;
      const specifiers = (value: string) => (value.match(SPECIFIER) ?? []).sort().join(' ');
      export default (candidate: string, source: string) =>
        specifiers(candidate) === specifiers(source) ? null : 'specifiers changed: [' + specifiers(source) + '] → [' + specifiers(candidate) + ']';
    `);
    expect(placeholders.check('%2$@ ma %1$lld', '%1$lld items in %2$@', ctx())).toBeNull();
    expect(placeholders.check('godzinę temu', '%1$s hours ago', ctx())?.reason).toBe('specifiers changed: [%1$s] → []');
  });

  test('the reason is capped', () => {
    expect(guard(`export default () => 'x'.repeat(10000)`).check('a', 'b', ctx())?.reason).toHaveLength(500);
  });

  test('the repair prompt is a template over the reason and the value context', () => {
    const capped = guard(`export default () => 'too long'`, { prompt: 'Shorten to {{meta.maxLength}} characters in {{locale}}. {{reason}}', attempts: 3 });
    expect(capped.repairAttempts).toBe(3);
    expect(capped.repair?.('Hello', ctx({ meta: { maxLength: 5 } }), 'too long')).toBe('Shorten to 5 characters in pl. too long');
    expect(guard(`export default () => null`).repair).toBeUndefined();
  });
});

describe('code fixes', () => {
  test('a guard can rewrite the candidate, with or without saying why', () => {
    const colon = guard(`export default (candidate: string, source: string) =>
      source.endsWith(':') && !candidate.endsWith(':') ? { fix: candidate + ':', reason: 'restored the trailing colon' } : null`);
    expect(colon.check('Name', 'Name:', ctx())).toEqual({ kind: 'fix', value: 'Name:', reason: 'restored the trailing colon' });
    expect(colon.check('Name:', 'Name:', ctx())).toBeNull();
    expect(guard(`export default (c: string) => ({ fix: c.trim() })`).check(' a ', 'b', ctx())).toEqual({ kind: 'fix', value: 'a', reason: null });
  });

  test('a fix that changes nothing is a pass', () => {
    expect(guard(`export default (candidate: string) => ({ fix: candidate, reason: 'noop' })`).check('a', 'b', ctx())).toBeNull();
  });

  test('a malformed fix fails closed', () => {
    expect(guard(`export default () => ({ fix: 42 })`).check('a', 'b', ctx())?.reason).toMatch(/^guard failed: returned object without a string `fix`/);
    expect(guard(`export default () => ['a']`).check('a', 'b', ctx())?.reason).toMatch(/^guard failed: returned object/);
    expect(guard(`export default () => ({ fix: 'x'.repeat(20001) })`).check('a', 'b', ctx())?.reason).toBe('guard failed: fix is longer than 20000 characters');
    expect(guard(`export default () => ({ get fix() { throw new Error('nope') } })`).check('a', 'b', ctx())).toEqual({ kind: 'reject', reason: 'guard failed: Error: nope', repairable: false });
    expect(guard(`export default () => ({ get fix(): string { while (true) {} } })`).check('a', 'b', ctx())?.reason).toBe('guard failed: timed out after 50 ms');
  });

  test('a guard that replaces JSON.stringify cannot forge its answer', () => {
    const forged = guard(`JSON.stringify = () => '{"fix":"forged"}'; export default () => ({ fix: 'real' })`);
    expect(forged.check('a', 'b', ctx())).toEqual({ kind: 'fix', value: 'real', reason: null });
  });

  test('the dry run answers the fix', async () => {
    expect(await tryGuard(`export default () => ({ fix: 'b', reason: 'why' })`, { candidate: 'a', source: 'b', ctx: ctx() })).toEqual({ ok: true, value: { fix: 'b', reason: 'why' } });
  });
});

describe('failing closed', () => {
  test('a guard that throws, answers the wrong type, or does not load rejects the value and is never repaired', () => {
    expect(guard(`export default () => { throw new Error('boom') }`).check('a', 'b', ctx())).toEqual({ kind: 'reject', reason: 'guard failed: Error: boom', repairable: false });
    expect(guard(`export default () => 42`).check('a', 'b', ctx())?.reason).toMatch(/^guard failed: returned number/);
    expect(guard(`export default () => Promise.resolve(null)`).check('a', 'b', ctx())?.reason).toMatch(/^guard failed: returned object/);
    expect(guard(`export default (candidate =>`).check('a', 'b', ctx())).toMatchObject({ reason: expect.stringMatching(/^guard does not load: does not compile/), repairable: false });
    expect(guard(`export const check = () => null`).check('a', 'b', ctx())?.reason).toMatch(/^guard does not load: must be `export default/);
  });
});

describe('sandbox', () => {
  test('nothing of the host is reachable: no process, network, modules or timers', async () => {
    const globals = ['process', 'require', 'module', 'fetch', 'Bun', 'Deno', 'setTimeout', 'XMLHttpRequest', 'WebSocket', 'WebAssembly'];
    const probe = guard(`export default () => ${JSON.stringify(globals)}.map((name) => typeof (globalThis as Record<string, unknown>)[name]).join()`);
    expect(probe.check('a', 'b', ctx())?.reason).toBe(globals.map(() => 'undefined').join());
    expect(guard(`export default () => require('fs')`).check('a', 'b', ctx())?.reason).toBe("guard failed: ReferenceError: 'require' is not defined");
    expect(guard(`export default () => process.env.NODE_ENV`).check('a', 'b', ctx())?.reason).toBe("guard failed: ReferenceError: 'process' is not defined");
    expect(guard(`import fs from 'fs'; export default () => null`).check('a', 'b', ctx())?.reason).toMatch(/could not load module 'fs'/);
    expect(await tryGuard(`export default () => String(this?.constructor?.constructor)`, { candidate: 'a', source: 'b', ctx: ctx() })).toEqual({ ok: true, value: 'undefined' });
  });

  test('runaway code is cut off by time, memory and stack, and is not called again once it exhausts its budget', () => {
    const loop = guard(`export default () => { while (true) {} }`);
    expect(loop.check('a', 'b', ctx())?.reason).toBe('guard failed: timed out after 50 ms');
    const started = performance.now();
    expect(loop.check('a', 'b', ctx())?.reason).toBe('guard failed: timed out after 50 ms');
    expect(performance.now() - started).toBeLessThan(5);
    expect(guard(`export default () => 'x'.repeat(64 * 1024 * 1024)`).check('a', 'b', ctx())?.reason).toBe('guard failed: InternalError: out of memory');
    expect(guard(`const f = (): number => f(); export default () => String(f())`).check('a', 'b', ctx())?.reason).toMatch(/stack overflow/);
    expect(guard(`while (true) {} export default () => null`).check('a', 'b', ctx())?.reason).toBe('guard does not load: timed out after 250 ms');
  });

  test('code that replaces globals cannot tamper with the inputs it is handed', () => {
    const tamper = guard(`JSON.parse = () => ({ locale: 'hacked' }); export default (_c: string, _s: string, ctx: { locale: string }) => ctx.locale`);
    expect(tamper.check('a', 'b', ctx())?.reason).toBe('pl');
  });

  test('guards do not share state with each other', () => {
    guard(`globalThis.leaked = 'yes'; export default () => null`).check('a', 'b', ctx());
    expect(guard(`export default () => typeof globalThis.leaked`).check('a', 'b', ctx())?.reason).toBe('undefined');
  });
});

describe('isPlaceholderOnlyKey', () => {
  test('flags keys with nothing translatable', () => {
    expect(isPlaceholderOnlyKey('%@')).toBe(true);
    expect(isPlaceholderOnlyKey('%1$@ - %2$@')).toBe(true);
    expect(isPlaceholderOnlyKey('1.5×')).toBe(false);
    expect(isPlaceholderOnlyKey('%@ items')).toBe(false);
  });
});
