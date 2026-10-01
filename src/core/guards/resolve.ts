import type { GuardRow } from '../../db/schema';
import type { ResolutionScope } from '../layers/resolve';
import type { GuardPool } from './pool';
import type { Guard } from './types';

/** Every enabled guard of every scenario the resource belongs to. */
export const resolveGuards = (rows: GuardRow[], pool: GuardPool, scope: ResolutionScope): Guard[] =>
  rows.filter((row) => row.enabled && scope.scenarioIds.includes(row.scenarioId)).map(pool.guard);
