import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { type Project, resources, targets, verdicts } from '../../db/schema';
import { createGuardPool, resolveGuards } from '../guards';
import { loadLayerCatalog, scopeOf } from '../layers/resolve';
import type { ValueContext } from '../model/types';

const CHUNK = 500;

/**
 * Legacy translations are trusted on import, but only as far as the guards would trust a model:
 * a value that fails one is imported as `rejected`, its value and origin kept, the reason on the
 * target — so what the previous pipeline let through becomes a queue to re-translate, not a silent pass.
 */
export const rejectLegacyFailures = async (db: Db, project: Project, targetIds: string[]): Promise<number> => {
  if (targetIds.length === 0) return 0;
  const catalog = await loadLayerCatalog(db);
  const scenarioIds = new Set(catalog.scenarios.filter((scenario) => scenario.projectId === project.id).map((scenario) => scenario.id));
  if (!catalog.guards.some((guard) => guard.enabled && scenarioIds.has(guard.scenarioId))) return 0;
  using pool = await createGuardPool();
  const runId = randomUUID();
  let rejected = 0;

  for (let index = 0; index < targetIds.length; index += CHUNK) {
    const rows = await db
      .select({ target: targets, resource: resources })
      .from(targets)
      .innerJoin(resources, eq(resources.id, targets.resourceId))
      .where(and(inArray(targets.id, targetIds.slice(index, index + CHUNK)), eq(targets.status, 'translated')));

    for (const { target, resource } of rows) {
      if (target.value === null) continue;
      const ctx: ValueContext = { projectSlug: project.slug, sourceLocale: project.sourceLocale, locale: target.locale, key: resource.key, tags: resource.tags, meta: resource.meta };
      const guards = resolveGuards(catalog.guards, pool, scopeOf(catalog, { project, resource }));
      for (const guard of guards) {
        const verdict = guard.check(target.value, resource.source, ctx);
        if (!verdict) continue;
        // Imported human values are never rewritten: a guard that would fix one flags it instead.
        const reason = verdict.kind === 'fix' ? `would fix: ${verdict.reason ?? verdict.value}` : verdict.reason;
        await db.transaction(async (tx) => {
          await tx.insert(verdicts).values({ targetId: target.id, runId, guard: guard.name, outcome: 'reject', detail: reason });
          await tx.update(targets).set({ status: 'rejected', lastError: `legacy: ${reason}`, updatedAt: new Date() }).where(eq(targets.id, target.id));
        });
        rejected += 1;
        break;
      }
    }
  }
  return rejected;
};
