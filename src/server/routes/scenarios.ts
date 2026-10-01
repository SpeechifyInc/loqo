import { LoadAPIKeyError, NoSuchModelError } from 'ai';
import { z } from 'zod';
import { recordAudit } from '../../core/audit/service';
import {
  authorGuard,
  createGuard,
  DEFAULT_AUTHOR_MODEL,
  type GuardAnswer,
  type GuardTestResult,
  guardAuthorInput,
  guardInput,
  guardTestInput,
  isGuardNameTaken,
  type Result,
  tryGuard,
} from '../../core/guards';
import { createLayer, createPrompt, REASONING_EFFORTS, upsertOverride } from '../../core/layers/service';
import { explainFlow } from '../../core/scenarios/flow';
import { createScenario, deleteScenario, getScenario, listScenarios, updateScenario } from '../../core/scenarios/service';
import type { MemberRole } from '../../db/schema';
import { type AppContext, actorOf, type RequestContext, route } from '../context';
import { HttpError, json, notFound, parseBody } from '../http';
import { requireProject } from './projects';

const reasoning = z.enum(REASONING_EFFORTS).nullable().optional();

/** `provider:model`, the only spelling the registry resolves. */
export const modelRef = z.string().regex(/^[\w.-]+:[\w./:-]+$/, 'expected provider:model');

const scenarioInput = z.object({ name: z.string().trim().min(1), tags: z.array(z.string().trim().min(1)).default([]) });

export const layerInput = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  position: z.number().int(),
  model: modelRef,
  reasoningEffort: reasoning,
  enabled: z.boolean().optional(),
  description: z.string().nullable().optional(),
});

export const promptInput = z.object({
  layerId: z.uuid().nullable(),
  name: z.string().min(1),
  position: z.number().int().optional(),
  enabled: z.boolean().optional(),
  body: z.string().min(1),
});

const overrideInput = z.object({
  layerId: z.uuid(),
  model: modelRef.nullable().optional(),
  reasoningEffort: reasoning,
  enabled: z.boolean().nullable().optional(),
});

/** Refuses code the sandbox cannot load, so a saved guard never fails at load time in the worker. */
export const requireLoadableGuard = async (code: string): Promise<void> => {
  const loaded = await tryGuard(code);
  if (!loaded.ok) throw new HttpError(422, `guard code does not load: ${loaded.error}`);
};

export const guardNameTaken = (name: string) => new HttpError(409, `this scenario already has a guard named "${name}"`);

const testResultOf = (result: Result<GuardAnswer>, ms: number): GuardTestResult => {
  if (!result.ok) return { error: result.error, ms };
  const answer = result.value;
  if (answer === null || typeof answer === 'string') return { reason: answer, ms };
  return { fix: answer.fix, reason: answer.reason, ms };
};

/** A model that is not registered or has no API key is a setup problem; anything else is the provider failing. */
const authoringFailed = (model: string, error: unknown): HttpError => {
  const message = error instanceof Error ? error.message : String(error);
  if (NoSuchModelError.isInstance(error) || LoadAPIKeyError.isInstance(error)) return new HttpError(422, `author model "${model}" is not available: ${message}`);
  return new HttpError(502, `author model "${model}" failed: ${message}`);
};

const builtinScenario = () => new HttpError(403, 'built-in scenario is read-only; attach prompts, layers or guards to it instead');

export const scenarioRoutes = (ctx: AppContext) => {
  const r = route(ctx);

  const requireScenario = async (rc: RequestContext, params: { slug: string; id: string }, min: MemberRole) => {
    const project = await requireProject(rc, params.slug, min);
    const scenario = await getScenario(rc.db, params.id);
    if (!scenario || scenario.projectId !== project.id) throw notFound('scenario');
    return { project, scenario };
  };

  type Owner = Awaited<ReturnType<typeof requireScenario>>;

  const created = async (rc: RequestContext, owner: Owner, action: string, body: unknown, detail: Record<string, unknown>): Promise<Response> => {
    await recordAudit(rc.db, { actor: actorOf(rc), action, projectId: owner.project.id, detail: { scenario: owner.scenario.name, ...detail } });
    return json(body, 201);
  };

  return {
    '/api/projects/:slug/scenarios': {
      GET: r<'/api/projects/:slug/scenarios'>(async (req, rc) => {
        const project = await requireProject(rc, req.params.slug, 'reader');
        return json(await listScenarios(rc.db, project.id));
      }),
      POST: r<'/api/projects/:slug/scenarios'>(async (req, rc) => {
        const project = await requireProject(rc, req.params.slug, 'admin');
        const scenario = await createScenario(rc.db, project.id, await parseBody(req, scenarioInput));
        await recordAudit(rc.db, { actor: actorOf(rc), action: 'scenario.create', projectId: project.id, detail: { name: scenario.name, tags: scenario.tags } });
        return json(scenario, 201);
      }),
    },
    '/api/projects/:slug/scenarios/:id': {
      PATCH: r<'/api/projects/:slug/scenarios/:id'>(async (req, rc) => {
        const { project, scenario } = await requireScenario(rc, req.params, 'admin');
        if (scenario.builtin) throw builtinScenario();
        const input = await parseBody(req, scenarioInput.partial());
        const updated = await updateScenario(rc.db, scenario.id, input);
        await recordAudit(rc.db, { actor: actorOf(rc), action: 'scenario.update', projectId: project.id, detail: { name: scenario.name, ...input } });
        return json(updated);
      }),
      DELETE: r<'/api/projects/:slug/scenarios/:id'>(async (req, rc) => {
        const { project, scenario } = await requireScenario(rc, req.params, 'admin');
        if (scenario.builtin) throw builtinScenario();
        await deleteScenario(rc.db, scenario.id);
        await recordAudit(rc.db, { actor: actorOf(rc), action: 'scenario.delete', projectId: project.id, detail: { name: scenario.name } });
        return json({ ok: true });
      }),
    },
    /** What would run for a resource of this scenario — the graph the flow page draws. */
    '/api/projects/:slug/scenarios/:id/flow': {
      GET: r<'/api/projects/:slug/scenarios/:id/flow'>(async (req, rc) => {
        const { project, scenario } = await requireScenario(rc, req.params, 'reader');
        return json(await explainFlow(rc, project, scenario));
      }),
    },
    '/api/projects/:slug/scenarios/:id/layers': {
      POST: r<'/api/projects/:slug/scenarios/:id/layers'>(async (req, rc) => {
        const owner = await requireScenario(rc, req.params, 'admin');
        const layer = await createLayer(rc.db, { ...(await parseBody(req, layerInput)), scope: 'scenario', scopeRef: owner.scenario.id });
        return created(rc, owner, 'layer.create', layer, { name: layer.name, model: layer.model });
      }),
    },
    '/api/projects/:slug/scenarios/:id/prompts': {
      POST: r<'/api/projects/:slug/scenarios/:id/prompts'>(async (req, rc) => {
        const owner = await requireScenario(rc, req.params, 'admin');
        const prompt = await createPrompt(rc.db, { ...(await parseBody(req, promptInput)), scope: 'scenario', scopeRef: owner.scenario.id });
        return created(rc, owner, 'prompt.create', prompt, { name: prompt.name, layerId: prompt.layerId });
      }),
    },
    '/api/projects/:slug/scenarios/:id/overrides': {
      POST: r<'/api/projects/:slug/scenarios/:id/overrides'>(async (req, rc) => {
        const owner = await requireScenario(rc, req.params, 'admin');
        const override = await upsertOverride(rc.db, { ...(await parseBody(req, overrideInput)), scope: 'scenario', scopeRef: owner.scenario.id });
        return created(rc, owner, 'override.upsert', override, { layerId: override.layerId, model: override.model, reasoningEffort: override.reasoningEffort, enabled: override.enabled });
      }),
    },
    '/api/projects/:slug/scenarios/:id/guards': {
      POST: r<'/api/projects/:slug/scenarios/:id/guards'>(async (req, rc) => {
        const owner = await requireScenario(rc, req.params, 'admin');
        const input = await parseBody(req, guardInput);
        if (await isGuardNameTaken(rc.db, owner.scenario.id, input.name)) throw guardNameTaken(input.name);
        await requireLoadableGuard(input.code);
        const guard = await createGuard(rc.db, owner.scenario.id, input);
        return created(rc, owner, 'guard.create', guard, { name: guard.name, code: guard.code, repair: guard.repair });
      }),
    },
    /** Runs unsaved code once against a sample, in the same sandbox the pipeline uses; nothing is stored. */
    '/api/projects/:slug/guards/test': {
      POST: r<'/api/projects/:slug/guards/test'>(async (req, rc) => {
        const project = await requireProject(rc, req.params.slug, 'admin');
        const { code, candidate, source, locale, key, tags, meta } = await parseBody(req, guardTestInput);
        const ctx = { projectSlug: project.slug, sourceLocale: project.sourceLocale, locale, key, tags, meta };
        const started = performance.now();
        const result = await tryGuard(code, { candidate, source, ctx });
        const ms = Math.round(performance.now() - started);
        return json(testResultOf(result, ms));
      }),
    },
    /** Writes guard code, a repair prompt and seeds from a brief, and runs the code on the seeds; nothing is stored. */
    '/api/projects/:slug/scenarios/:id/guards/author': {
      POST: r<'/api/projects/:slug/scenarios/:id/guards/author'>(async (req, rc) => {
        const { project, scenario } = await requireScenario(rc, req.params, 'admin');
        const input = await parseBody(req, guardAuthorInput);
        const model = rc.config.authorModel ?? DEFAULT_AUTHOR_MODEL;
        const authored = await authorGuard({ models: rc.models, model }, input, project, scenario.tags).catch((error: unknown) => {
          throw authoringFailed(model, error);
        });
        return json(authored);
      }),
    },
  };
};
