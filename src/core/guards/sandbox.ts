import variant from '@jitl/quickjs-wasmfile-release-sync';
import { newQuickJSWASMModuleFromVariant, type QuickJSHandle, type QuickJSWASMModule, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';
import type { ValueContext } from '../model/types';
import { GUARD_LIMITS } from './definition';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** A rewrite of the candidate; `reason` says what was fixed. */
export type GuardFix = { fix: string; reason: string | null };

/** `null` passes, a string is the rejection reason, a fix replaces the candidate. */
export type GuardAnswer = string | GuardFix | null;

/** A loaded guard module. `run` answers how the candidate fares. */
export type SandboxedGuard = Disposable & { run(candidate: string, source: string, ctx: ValueContext): Result<GuardAnswer> };

let engine: Promise<QuickJSWASMModule> | undefined;

/** One WASM module per process; every guard gets a runtime of its own on it, with its own heap. */
export const quickjsEngine = (): Promise<QuickJSWASMModule> => {
  engine ??= newQuickJSWASMModuleFromVariant(variant);
  return engine;
};

/** Bun inlines `process.env.NODE_ENV` by default; keep it a lookup, which fails in the sandbox like any host global. */
const transpiler = new Bun.Transpiler({ loader: 'ts', define: { 'process.env.NODE_ENV': 'process.env.NODE_ENV' } });

/** Out of time or memory: these cost up to a second each, so the guard is not called again. */
const EXHAUSTED = /^InternalError: (interrupted|out of memory)$/;

const describe = (error: unknown): string => {
  if (typeof error !== 'object' || error === null || !('message' in error)) return String(error);
  const { name, message } = error as { name?: unknown; message?: unknown };
  return typeof name === 'string' ? `${name}: ${String(message)}` : String(message);
};

const readable = (error: string, ms: number): string => error.replace('InternalError: interrupted', `timed out after ${ms} ms`);

const SIGNATURE = 'export default (candidate, source, ctx) => reason | { fix } | null';
const RETURNS = 'null, a string (the rejection reason) or { fix, reason? }';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads a returned object from its JSON form; a fix that changes nothing is a pass. */
const fixOf = (json: string, candidate: string): Result<GuardAnswer> => {
  const answer: unknown = json ? JSON.parse(json) : null;
  if (!isRecord(answer) || typeof answer.fix !== 'string') return { ok: false, error: `returned object without a string \`fix\`; must return ${RETURNS}` };
  if (answer.fix.length > GUARD_LIMITS.valueChars) return { ok: false, error: `fix is longer than ${GUARD_LIMITS.valueChars} characters` };
  if (answer.fix === candidate) return { ok: true, value: null };
  const reason = typeof answer.reason === 'string' ? answer.reason.slice(0, GUARD_LIMITS.reasonChars) || null : null;
  return { ok: true, value: { fix: answer.fix, reason } };
};

/**
 * TypeScript is transpiled (types stripped, not checked), then evaluated as an ES module in a fresh
 * QuickJS runtime: no `process`, `fetch`, `require`, timers or module loader — only the language.
 * Every evaluation runs under a deadline, a memory cap and a stack cap.
 */
export const loadGuard = (quickjs: QuickJSWASMModule, code: string): Result<SandboxedGuard> => {
  let js: string;
  try {
    js = transpiler.transformSync(code);
  } catch (error) {
    return { ok: false, error: `does not compile: ${describe(error)}` };
  }

  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(GUARD_LIMITS.memoryBytes);
  runtime.setMaxStackSize(GUARD_LIMITS.stackBytes);
  const context = runtime.newContext();
  const owned: QuickJSHandle[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const handle of owned) handle.dispose();
    context.dispose();
    runtime.dispose();
  };
  const fail = (error: string): Result<SandboxedGuard> => {
    dispose();
    return { ok: false, error };
  };

  // Taken before the module runs, so code that reassigns the global cannot tamper with its own inputs.
  const json = context.getProp(context.global, 'JSON');
  const parse = context.getProp(json, 'parse');
  const stringify = context.getProp(json, 'stringify');
  owned.push(json, parse, stringify);

  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + GUARD_LIMITS.loadMs));
  const evaluated = context.evalCode(js, 'guard.ts', { type: 'module' });
  if (evaluated.error) {
    const error = describe(context.dump(evaluated.error));
    evaluated.error.dispose();
    return fail(readable(error, GUARD_LIMITS.loadMs));
  }
  const guard = context.getProp(evaluated.value, 'default');
  evaluated.value.dispose();
  owned.push(guard);
  if (context.typeof(guard) !== 'function') return fail(`must be \`${SIGNATURE}\``);

  let exhausted: string | null = null;

  const failure = (handle: QuickJSHandle): Result<GuardAnswer> => {
    const error = describe(context.dump(handle));
    handle.dispose();
    if (EXHAUSTED.test(error)) exhausted = readable(error, GUARD_LIMITS.callMs);
    return { ok: false, error: readable(error, GUARD_LIMITS.callMs) };
  };

  const run = (candidate: string, source: string, ctx: ValueContext): Result<GuardAnswer> => {
    if (disposed) return { ok: false, error: 'guard was unloaded' };
    if (exhausted) return { ok: false, error: exhausted };
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + GUARD_LIMITS.callMs));
    const ctxJson = context.newString(JSON.stringify(ctx));
    const parsed = context.callFunction(parse, context.undefined, ctxJson);
    ctxJson.dispose();
    if (parsed.error) {
      parsed.error.dispose();
      return { ok: false, error: 'context does not fit the sandbox' };
    }
    const args = [context.newString(candidate), context.newString(source), parsed.value];
    const result = context.callFunction(guard, context.undefined, ...args);
    for (const handle of args) handle.dispose();
    if (result.error) return failure(result.error);

    const kind = context.typeof(result.value);
    if (kind === 'object' && !context.sameValue(result.value, context.null)) {
      // Serialized inside the sandbox, under the same deadline, so getters and `toJSON` never run on the host.
      const serialized = context.callFunction(stringify, context.undefined, result.value);
      result.value.dispose();
      if (serialized.error) return failure(serialized.error);
      const text = context.typeof(serialized.value) === 'string' ? context.getString(serialized.value) : '';
      serialized.value.dispose();
      return fixOf(text, candidate);
    }
    const isNull = kind === 'undefined' || context.sameValue(result.value, context.null);
    const reason = kind === 'string' ? context.getString(result.value).slice(0, GUARD_LIMITS.reasonChars) : null;
    result.value.dispose();
    if (kind === 'string') return { ok: true, value: reason || null };
    if (isNull) return { ok: true, value: null };
    return { ok: false, error: `returned ${kind}; must return ${RETURNS}` };
  };

  return { ok: true, value: { run, [Symbol.dispose]: dispose } };
};

/** Loads and runs unsaved code once, for the editor's Test button and for validation on save. */
export const tryGuard = async (code: string, sample?: { candidate: string; source: string; ctx: ValueContext }): Promise<Result<GuardAnswer>> => {
  const loaded = loadGuard(await quickjsEngine(), code);
  if (!loaded.ok) return loaded;
  using guard = loaded.value;
  return sample ? guard.run(sample.candidate, sample.source, sample.ctx) : { ok: true, value: null };
};
