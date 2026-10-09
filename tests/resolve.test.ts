import { describe, expect, test } from 'bun:test';
import { createGuardPool, resolveGuards } from '../src/core/guards';
import { type CompiledPrompt, explainLayers, type LayerCatalog, resolveLayers, scopeOf } from '../src/core/layers/resolve';
import { compileTemplate, type TemplateContext } from '../src/core/prompts/template';
import { matchesScenario } from '../src/core/scenarios/service';
import type { GuardRow, Layer, LayerOverride, Scenario } from '../src/db/schema';

const now = new Date();

const layer = (overrides: Partial<Layer> & Pick<Layer, 'id' | 'name' | 'position'>): Layer => ({
  model: 'openai:gpt-4.1',
  reasoningEffort: null,
  enabled: true,
  description: null,
  scope: 'default',
  scopeRef: null,
  builtin: true,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const prompt = (overrides: Partial<CompiledPrompt> & Pick<CompiledPrompt, 'id' | 'name' | 'body'>): CompiledPrompt => ({
  layerId: null,
  scope: 'default',
  scopeRef: null,
  position: 100,
  enabled: true,
  builtin: true,
  createdAt: now,
  updatedAt: now,
  versionId: `v-${overrides.id}`,
  version: 1,
  render: compileTemplate(overrides.body),
  ...overrides,
});

const override = (overrides: Partial<LayerOverride> & Pick<LayerOverride, 'id' | 'layerId' | 'scope' | 'scopeRef'>): LayerOverride => ({
  model: null,
  reasoningEffort: null,
  enabled: null,
  createdAt: now,
  ...overrides,
});

const guardRow = (overrides: Partial<GuardRow> & Pick<GuardRow, 'id' | 'name' | 'scenarioId'>): GuardRow => ({
  description: null,
  brief: null,
  code: 'export default () => null',
  repair: null,
  enabled: true,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const scenario = (overrides: Partial<Scenario> & Pick<Scenario, 'id' | 'projectId' | 'tags'>): Scenario => ({ name: overrides.id, builtin: false, createdAt: now, updatedAt: now, ...overrides });

const context: TemplateContext = { locale: 'de', localeName: 'German', sourceLocale: 'en', sourceLocaleName: 'English', project: { slug: 'p', name: 'P' }, key: 'k', source: 'Hello', tags: ['ios'], meta: {}, glossaryTable: '', lengthBudget: null, nativeExamples: [] };

const ios = scenario({ id: 'sc-ios', projectId: 'p1', tags: ['ios'] });
const releases = scenario({ id: 'sc-rel', projectId: 'p1', tags: ['ios', 'ios-releases'] });
const other = scenario({ id: 'sc-other', projectId: 'p2', tags: [] });

const catalog: LayerCatalog = {
  layers: [
    layer({ id: 'L1', name: 'translate', position: 10 }),
    layer({ id: 'L2', name: 'enhance', position: 20 }),
    layer({ id: 'L3', name: 'polish', position: 15, scope: 'scenario', scopeRef: 'sc-ios', builtin: false }),
    layer({ id: 'L4', name: 'other-only', position: 16, scope: 'scenario', scopeRef: 'sc-other', builtin: false }),
  ],
  prompts: [
    prompt({ id: 'P1', name: 'translate/base', body: 'Translate to {{localeName}}.', layerId: 'L1', position: 10 }),
    prompt({ id: 'P2', name: 'enhance/base', body: 'Refine.', layerId: 'L2', position: 10 }),
    prompt({ id: 'P3', name: 'ios-tone', body: 'Be terse.', scope: 'scenario', scopeRef: 'sc-ios', position: 50, builtin: false }),
    prompt({ id: 'P4', name: 'length', body: '{{#if lengthBudget}}Max {{lengthBudget}}.{{/if}}', position: 95 }),
    prompt({ id: 'P5', name: 'polish/base', body: 'Polish.', layerId: 'L3', position: 10, builtin: false }),
    prompt({ id: 'P6', name: 'off', body: 'Never.', enabled: false }),
  ],
  overrides: [override({ id: 'O1', layerId: 'L2', scope: 'scenario', scopeRef: 'sc-rel', enabled: false })],
  scenarios: [ios, releases, other],
  guards: [],
};

describe('matchesScenario', () => {
  test('requires the same project and every tag; empty tags match the whole project', () => {
    expect(matchesScenario(ios, { projectId: 'p1', tags: ['ios', 'plural'] })).toBe(true);
    expect(matchesScenario(ios, { projectId: 'p1', tags: ['android'] })).toBe(false);
    expect(matchesScenario(releases, { projectId: 'p1', tags: ['ios'] })).toBe(false);
    expect(matchesScenario(other, { projectId: 'p2', tags: [] })).toBe(true);
    expect(matchesScenario(other, { projectId: 'p1', tags: [] })).toBe(false);
  });

  test('scopeOf collects every matching scenario id', () => {
    const scope = scopeOf(catalog, { project: { id: 'p1', slug: 'p' }, resource: { id: 'r', tags: ['ios', 'ios-releases'] } });
    expect(scope.scenarioIds).toEqual(['sc-ios', 'sc-rel']);
  });
});

describe('explainLayers', () => {
  const scopeIos = { projectSlug: 'p', tags: ['ios'], resourceId: 'r', scenarioIds: ['sc-ios'] };

  test('scenario prompts and layers only apply inside their scenario, interleaved by position', () => {
    const explained = explainLayers(catalog, scopeIos, context);
    expect(explained.map((entry) => [entry.layer.name, entry.state])).toEqual([
      ['translate', 'active'],
      ['polish', 'active'],
      ['other-only', 'out-of-scope'],
      ['enhance', 'active'],
    ]);
    const translate = explained[0];
    expect(translate?.prompts.map((entry) => [entry.prompt.name, entry.state])).toEqual([
      ['translate/base', 'active'],
      ['ios-tone', 'active'],
      ['length', 'empty'],
      ['off', 'disabled'],
    ]);

    const outside = explainLayers(catalog, { ...scopeIos, tags: ['android'], scenarioIds: [] }, context);
    expect(outside.find((entry) => entry.layer.name === 'polish')?.state).toBe('out-of-scope');
    expect(outside[0]?.prompts.find((entry) => entry.prompt.name === 'ios-tone')?.state).toBe('out-of-scope');
  });

  test('a scenario override can switch a built-in layer off', () => {
    const explained = explainLayers(catalog, { ...scopeIos, scenarioIds: ['sc-ios', 'sc-rel'] }, context);
    const enhance = explained.find((entry) => entry.layer.name === 'enhance');
    expect(enhance?.state).toBe('disabled');
    expect(enhance?.effective.enabled).toBe(false);
    expect(enhance?.overrides.map((entry) => entry.id)).toEqual(['O1']);
  });

  test('resolveLayers is the active projection with joined fragments', () => {
    const resolved = resolveLayers(catalog, scopeIos, context);
    expect(resolved.map((entry) => entry.name)).toEqual(['translate', 'polish', 'enhance']);
    expect(resolved[0]?.systemPrompt).toBe('Translate to German.\n\nBe terse.');
    expect(resolved[0]?.promptVersionIds).toEqual(['v-P1', 'v-P3']);
  });
});

describe('resolveGuards', () => {
  const scope = { projectSlug: 'p', tags: ['ios'], resourceId: 'r', scenarioIds: ['sc-default', 'sc-ios'] };

  test('every enabled guard of every scenario the resource belongs to, and nothing else', async () => {
    using pool = await createGuardPool();
    const rows = [
      guardRow({ id: 'G1', name: 'everywhere', scenarioId: 'sc-default' }),
      guardRow({ id: 'G2', name: 'ios-only', scenarioId: 'sc-ios' }),
      guardRow({ id: 'G3', name: 'android-only', scenarioId: 'sc-android' }),
      guardRow({ id: 'G4', name: 'switched-off', scenarioId: 'sc-ios', enabled: false }),
    ];
    expect(resolveGuards(rows, pool, scope).map((guard) => guard.name)).toEqual(['everywhere', 'ios-only']);
    expect(resolveGuards([], pool, scope)).toEqual([]);
  });
});
