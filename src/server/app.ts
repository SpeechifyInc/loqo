import type { AppContext } from './context';
import { json } from './http';
import { apiKeyRoutes } from './routes/api-keys';
import { authRoutes } from './routes/auth';
import { layerRoutes } from './routes/layers';
import { opsRoutes } from './routes/ops';
import { projectRoutes } from './routes/projects';
import { resourceRoutes } from './routes/resources';
import { scenarioRoutes } from './routes/scenarios';
import index from '../ui/index.html';

export type ServeOptions = { port: number; development: boolean };

export const startServer = (ctx: AppContext, options: ServeOptions) =>
  Bun.serve({
    port: options.port,
    // Writing a guard from a brief waits on a model for up to a few minutes; Bun's default closes a quiet connection after 10 s.
    idleTimeout: 180,
    development: options.development ? { hmr: true, console: true } : false,
    routes: {
      ...authRoutes(ctx),
      ...opsRoutes(ctx),
      ...projectRoutes(ctx),
      ...apiKeyRoutes(ctx),
      ...resourceRoutes(ctx),
      ...scenarioRoutes(ctx),
      ...layerRoutes(ctx),
      '/api/*': () => json({ error: 'Not found' }, 404),
      // Everything else is the single-page UI; it owns its own routing.
      '/': index,
      '/*': index,
    },
    error: (error) => {
      console.error(error);
      return json({ error: 'Internal error' }, 500);
    },
  });
