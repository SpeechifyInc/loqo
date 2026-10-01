import type { ValueContext } from '../model/types';

/**
 * A guard rejects the candidate or rewrites it. `repairable` is false when the guard itself failed:
 * a model cannot fix that.
 */
export type GuardVerdict = { kind: 'reject'; reason: string; repairable: boolean } | { kind: 'fix'; value: string; reason: string | null };

/**
 * A guard as the pipeline runs it. A guard can fix what code can put back (a stray quote, a
 * spacing rule); what it cannot, like a dropped `%1$s`, goes back to a model or is thrown away.
 */
export type Guard = {
  readonly name: string;
  /** `null` when the candidate is acceptable as it is. */
  check(candidate: string, source: string, ctx: ValueContext): GuardVerdict | null;
  /** System prompt for a repair call; absent when a rejection is final. */
  repair?(source: string, ctx: ValueContext, reason: string): string;
  readonly repairAttempts: number;
};
