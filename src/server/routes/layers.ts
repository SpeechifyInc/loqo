import { z } from 'zod';
import { recordAudit } from '../../core/audit/service';
import { deleteGuard, getGuard, guardInput, isGuardNameTaken, updateGuard } from '../../core/guards';
import { addPromptVersion, deleteLayer, deleteOverride, deletePrompt, getLayer, getOverride, getPrompt, listPromptVersions, updateLayer, updatePrompt } from '../../core/layers/service';
import { getScenario } from '../../core/scenarios/service';
import { getProjectById } from '../../core/projects/service';
import type { MemberRole } from '../../db/schema';
import { requireProjectRole } from '../authz';
import { type AppContext, actorOf, type RequestContext, route } from '../context';
import { HttpError, json, notFound, parseBody } from '../http';
import { guardNameTaken, layerInput, promptInput, requireLoadableGuard } from './scenarios';

type ScopedRow = { scope: string; scopeRef: string | null };

/**
 * Rows reached by id belong to a scenario, which belongs to a project — that is where the role
 * check happens. Built-ins (and anything not scenario-scoped) are seed-defined and read-only.
 */
const requireOwner = async (rc: RequestContext, what: string, row: ScopedRow | null, min: MemberRole) => {
  if (!row) throw notFound(what);
  const scenario = row.scope === 'scenario' && row.scopeRef ? await getScenario(rc.db, row.scopeRef) : null;
  if (!scenario) {
    if (min === 'reader') return null;
    throw new HttpError(403, `built-in ${what} is read-only`);
  }
  const project = await getProjectById(rc.db, scenario.projectId);
  if (!project) throw notFound(what);
  await requireProjectRole(rc, project, min);
  return project;
};

export const layerRoutes = (ctx: AppContext) => {
  const r = route(ctx);
  const audit = (rc: RequestContext, action: string, projectId: string | null, detail: Record<string, unknown>) =>
    recordAudit(rc.db, { actor: actorOf(rc), action, projectId, detail });

  return {
    '/api/layers/:id': {
      PATCH: r<'/api/layers/:id'>(async (req, rc) => {
        const project = await requireOwner(rc, 'layer', await getLayer(rc.db, req.params.id), 'admin');
        const input = await parseBody(req, layerInput.partial());
        const layer = await updateLayer(rc.db, req.params.id, input);
        if (!layer) throw notFound('layer');
        await audit(rc, 'layer.update', project?.id ?? null, { name: layer.name, ...input });
        return json(layer);
      }),
      DELETE: r<'/api/layers/:id'>(async (req, rc) => {
        const layer = await getLayer(rc.db, req.params.id);
        const project = await requireOwner(rc, 'layer', layer, 'admin');
        await deleteLayer(rc.db, req.params.id);
        await audit(rc, 'layer.delete', project?.id ?? null, { name: layer?.name });
        return json({ ok: true });
      }),
    },
    '/api/prompts/:id': {
      PATCH: r<'/api/prompts/:id'>(async (req, rc) => {
        const project = await requireOwner(rc, 'prompt', await getPrompt(rc.db, req.params.id), 'admin');
        const input = await parseBody(req, promptInput.omit({ body: true }).partial());
        const prompt = await updatePrompt(rc.db, req.params.id, input);
        if (!prompt) throw notFound('prompt');
        await audit(rc, 'prompt.update', project?.id ?? null, { name: prompt.name, ...input });
        return json(prompt);
      }),
      DELETE: r<'/api/prompts/:id'>(async (req, rc) => {
        const prompt = await getPrompt(rc.db, req.params.id);
        const project = await requireOwner(rc, 'prompt', prompt, 'admin');
        await deletePrompt(rc.db, req.params.id);
        await audit(rc, 'prompt.delete', project?.id ?? null, { name: prompt?.name });
        return json({ ok: true });
      }),
    },
    '/api/prompts/:id/versions': {
      GET: r<'/api/prompts/:id/versions'>(async (req, rc) => {
        await requireOwner(rc, 'prompt', await getPrompt(rc.db, req.params.id), 'reader');
        return json(await listPromptVersions(rc.db, req.params.id));
      }),
      POST: r<'/api/prompts/:id/versions'>(async (req, rc) => {
        const prompt = await getPrompt(rc.db, req.params.id);
        const project = await requireOwner(rc, 'prompt', prompt, 'admin');
        const { body } = await parseBody(req, z.object({ body: z.string().min(1) }));
        const version = await addPromptVersion(rc.db, req.params.id, body);
        await audit(rc, 'prompt.version', project?.id ?? null, { name: prompt?.name, version: version.version });
        return json(version, 201);
      }),
    },
    '/api/layer-overrides/:id': {
      DELETE: r<'/api/layer-overrides/:id'>(async (req, rc) => {
        const override = await getOverride(rc.db, req.params.id);
        const project = await requireOwner(rc, 'override', override, 'admin');
        await deleteOverride(rc.db, req.params.id);
        await audit(rc, 'override.delete', project?.id ?? null, { layerId: override?.layerId });
        return json({ ok: true });
      }),
    },
    '/api/guards/:id': {
      PATCH: r<'/api/guards/:id'>(async (req, rc) => {
        const current = await getGuard(rc.db, req.params.id);
        const project = await requireOwner(rc, 'guard', current && { scope: 'scenario', scopeRef: current.scenarioId }, 'admin');
        const input = await parseBody(req, guardInput.partial());
        if (current && input.name && (await isGuardNameTaken(rc.db, current.scenarioId, input.name, current.id))) throw guardNameTaken(input.name);
        if (input.code !== undefined) await requireLoadableGuard(input.code);
        const guard = await updateGuard(rc.db, req.params.id, input);
        if (!guard) throw notFound('guard');
        await audit(rc, 'guard.update', project?.id ?? null, { name: guard.name, ...input });
        return json(guard);
      }),
      DELETE: r<'/api/guards/:id'>(async (req, rc) => {
        const guard = await getGuard(rc.db, req.params.id);
        const project = await requireOwner(rc, 'guard', guard && { scope: 'scenario', scopeRef: guard.scenarioId }, 'admin');
        await deleteGuard(rc.db, req.params.id);
        await audit(rc, 'guard.delete', project?.id ?? null, { name: guard?.name });
        return json({ ok: true });
      }),
    },
  };
};
