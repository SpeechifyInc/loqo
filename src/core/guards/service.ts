import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { type GuardRow, guards } from '../../db/schema';
import type { GuardInput } from './definition';

export const getGuard = async (db: Db, id: string): Promise<GuardRow | null> => {
  const [row] = await db.select().from(guards).where(eq(guards.id, id)).limit(1);
  return row ?? null;
};

/** Names are unique per scenario; `exceptId` lets a guard keep its own name on update. */
export const isGuardNameTaken = async (db: Db, scenarioId: string, name: string, exceptId?: string): Promise<boolean> => {
  const [row] = await db
    .select({ id: guards.id })
    .from(guards)
    .where(and(eq(guards.scenarioId, scenarioId), eq(guards.name, name), exceptId ? ne(guards.id, exceptId) : undefined))
    .limit(1);
  return row !== undefined;
};

export const createGuard = async (db: Db, scenarioId: string, input: GuardInput): Promise<GuardRow> => {
  const [row] = await db
    .insert(guards)
    .values({ ...input, scenarioId })
    .returning();
  if (!row) throw new Error('insert returned no row');
  return row;
};

export const updateGuard = async (db: Db, id: string, input: Partial<GuardInput>): Promise<GuardRow | null> => {
  const [row] = await db
    .update(guards)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(guards.id, id))
    .returning();
  return row ?? null;
};

export const deleteGuard = async (db: Db, id: string): Promise<boolean> => (await db.delete(guards).where(eq(guards.id, id)).returning({ id: guards.id })).length > 0;
