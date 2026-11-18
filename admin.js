import { apply as applyMonitor } from './index.js';
import { registerAdminRoutes } from './admin-bridge.js';
export { inject } from './index.js';

/** Full human administration UI, with the existing Agent tool still read-only. */
export function apply(ctx) {
  applyMonitor(ctx);
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort());
  registerAdminRoutes(ctx, lifetime.signal);
}
