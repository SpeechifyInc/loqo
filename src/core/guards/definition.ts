import { z } from 'zod';

/**
 * A guard is data: a named JavaScript or TypeScript module a project admin writes in the flow UI,
 * attached to a scenario. It runs in a QuickJS sandbox with these limits and nothing of the host.
 */
export const GUARD_LIMITS = {
  codeChars: 20_000,
  briefChars: 4_000,
  valueChars: 20_000,
  loadMs: 250,
  callMs: 50,
  memoryBytes: 8 * 1024 * 1024,
  stackBytes: 256 * 1024,
  reasonChars: 500,
} as const;

export const guardRepair = z.object({
  prompt: z
    .string()
    .trim()
    .min(1)
    .describe('System prompt for the repair call; {{reason}}, {{locale}}, {{sourceLocale}}, {{key}}, {{source}} and {{meta.*}} are filled in'),
  attempts: z.number().int().min(1).max(5).optional().describe('Repair calls per value before it is rejected; 1 when empty'),
});

export type GuardRepair = z.infer<typeof guardRepair>;

const brief = z.string().trim().max(GUARD_LIMITS.briefChars);

export const guardInput = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and dashes'),
  description: z.string().trim().nullable().optional(),
  /** What the guard should catch, in plain words; what the Quick tab generated the code from. */
  brief: brief.nullable().optional(),
  enabled: z.boolean().optional(),
  code: z.string().min(1).max(GUARD_LIMITS.codeChars),
  repair: guardRepair.nullable().optional(),
});

export type GuardInput = z.infer<typeof guardInput>;

const value = z.string().max(GUARD_LIMITS.valueChars);

/** One dry run of unsaved code against a sample, from the editor's Test button. */
export const guardTestInput = z.object({
  code: guardInput.shape.code,
  candidate: value,
  source: value,
  locale: z.string().min(1).max(35).default('de'),
  key: z.string().max(500).default('sample.key'),
  tags: z.array(z.string().max(100)).max(50).default([]),
  meta: z
    .record(z.string(), z.unknown())
    .refine((meta) => JSON.stringify(meta).length <= GUARD_LIMITS.valueChars, 'meta is too large')
    .default({}),
});

export type GuardTestInput = z.input<typeof guardTestInput>;

/** A dry run passes (`reason: null`), rejects (`reason`), fixes (`fix`, with its `reason`), or the guard itself fails (`error`). */
export type GuardTestResult = { reason?: string | null; fix?: string; error?: string; ms: number };

/** A plain-language brief a model turns into guard code, a repair prompt and seeds to check them on. */
export const guardAuthorInput = z.object({
  brief: brief.min(1),
  name: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

export type GuardAuthorInput = z.input<typeof guardAuthorInput>;

/** A sample value and what the guard should make of it. */
export type GuardSeed = {
  note: string;
  source: string;
  candidate: string;
  locale: string;
  key: string;
  tags: string[];
  meta: Record<string, unknown>;
  expect: 'pass' | 'reject' | 'fix';
  /** The value a fix should produce; `null` when any fix will do. */
  fixed: string | null;
};

export type SeedOutcome =
  | { kind: 'pass' }
  | { kind: 'reject'; reason: string }
  | { kind: 'fix'; value: string; reason: string | null }
  | { kind: 'error'; error: string };

export type SeedResult = GuardSeed & { actual: SeedOutcome; ok: boolean };

export type AuthoredGuard = { code: string; repair: GuardRepair | null; seeds: SeedResult[]; attempts: number; model: string };
