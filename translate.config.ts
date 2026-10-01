import { defaultProviders, defineConfig } from './src/config';

/**
 * Code, not data: provider keys, code stages and the prompt fragments a deployment owns get code
 * review. Layers, models, prompts and guards are edited in the UI and stored in Postgres. Models
 * are addressed as `provider:model`. Adapters are not here at all: they run in the repos they sync,
 * against a project API key, via `@loqo/sdk`.
 *
 * This file is the platform's default. A deployment keeps its own next to a checkout and points
 * `TRANSLATE_CONFIG` at it — typically its brand's and product's vocabulary under `prompts`. Export
 * a function `({ db }) => ({ … })` instead when a stage needs the platform's database.
 */
export default defineConfig({
  providers: defaultProviders(),
});
