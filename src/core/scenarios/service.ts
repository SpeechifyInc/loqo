import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { type Scenario, layerOverrides, layers, projects, prompts, scenarios } from '../../db/schema';
import { DEFAULT_SCENARIO_NAME } from '../layers/defaults';

export type ScenarioInput = { name: string; tags: string[] };

const normalizeTags = (tags: string[]): string[] => [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort();

export const listScenarios = (db: Db, projectId: string): Promise<Scenario[]> =>
  db.select().from(scenarios).where(eq(scenarios.projectId, projectId)).orderBy(asc(scenarios.name));

export const getScenario = async (db: Db, id: string): Promise<Scenario | null> => {
  const [row] = await db.select().from(scenarios).where(eq(scenarios.id, id)).limit(1);
  return row ?? null;
};

export const createScenario = async (db: Db, projectId: string, input: ScenarioInput): Promise<Scenario> => {
  const [row] = await db.insert(scenarios).values({ projectId, name: input.name, tags: normalizeTags(input.tags) }).returning();
  if (!row) throw new Error('insert returned no row');
  return row;
};

export const updateScenario = async (db: Db, id: string, input: Partial<ScenarioInput>): Promise<Scenario | null> => {
  const [row] = await db
    .update(scenarios)
    .set({ ...input, ...(input.tags ? { tags: normalizeTags(input.tags) } : {}), updatedAt: new Date() })
    .where(eq(scenarios.id, id))
    .returning();
  return row ?? null;
};

/** Scoped rows reference scenarios by id in a text column, so this cascade is explicit; guards have a real foreign key. */
export const deleteScenarioScoped = async (tx: Tx, scenarioIds: string[]): Promise<void> => {
  if (scenarioIds.length === 0) return;
  await tx.delete(prompts).where(and(eq(prompts.scope, 'scenario'), inArray(prompts.scopeRef, scenarioIds)));
  await tx.delete(layerOverrides).where(and(eq(layerOverrides.scope, 'scenario'), inArray(layerOverrides.scopeRef, scenarioIds)));
  await tx.delete(layers).where(and(eq(layers.scope, 'scenario'), inArray(layers.scopeRef, scenarioIds)));
};

export const deleteScenario = (db: Db, id: string): Promise<boolean> =>
  db.transaction(async (tx) => {
    await deleteScenarioScoped(tx, [id]);
    return (await tx.delete(scenarios).where(eq(scenarios.id, id)).returning({ id: scenarios.id })).length > 0;
  });

/** Installs the project's `Default` scenario if it is missing; never touches a row that already exists. */
export const seedScenarios = async (db: Db | Tx, projectId: string): Promise<number> => {
  const inserted = await db
    .insert(scenarios)
    .values({ projectId, name: DEFAULT_SCENARIO_NAME, tags: [], builtin: true })
    .onConflictDoNothing({ target: [scenarios.projectId, scenarios.name] })
    .returning({ id: scenarios.id });
  return inserted.length;
};

export const seedAllScenarios = async (db: Db): Promise<number> => {
  const rows = await db.select({ id: projects.id }).from(projects);
  let total = 0;
  for (const row of rows) total += await seedScenarios(db, row.id);
  return total;
};

/** A scenario matches a resource of its own project that carries every one of its tags. */
export const matchesScenario = (scenario: Pick<Scenario, 'projectId' | 'tags'>, resource: { projectId: string; tags: string[] }): boolean =>
  scenario.projectId === resource.projectId && scenario.tags.every((tag) => resource.tags.includes(tag));

export const scenarioIdsFor = (all: Scenario[], resource: { projectId: string; tags: string[] }): string[] =>
  all.filter((scenario) => matchesScenario(scenario, resource)).map((scenario) => scenario.id);
