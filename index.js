import { createMonitor, MonitorError, publicError } from './monitor.js';

export const inject = ['connection', 'credentials', 'tools'];
const ROUTE = '/api/cpamp-monitor';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

export function apply(ctx) {
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort());
  const monitor = createMonitor({ credentials: ctx.credentials, signal: lifetime.signal });
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE, methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      // Connection authenticates the route. Binding/unbinding is restricted to the owner,
      // never delegated to an agent tool or a non-owner API principal.
      const admission = ctx.connection.admit(request);
      if (admission.rejection || admission.peer?.principal.kind !== 'owner') return json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the Harness owner can use this page.' } }, 403);
      if (request.headers.get('sec-fetch-site') === 'cross-site') return json({ ok: false, error: { code: 'FORBIDDEN', message: 'Cross-site requests are not allowed.' } }, 403);
      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ ok: false, error: { code: 'INVALID_INPUT', message: 'A JSON request is required.' } }, 415);
      try {
        const source = await request.text();
        if (source.length > 16384) throw new MonitorError('INVALID_INPUT', 'Request is too large.');
        let input;
        try { input = JSON.parse(source); } catch { throw new MonitorError('INVALID_INPUT', 'Invalid JSON request.'); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MonitorError('INVALID_INPUT', 'Invalid request.');
        const signal = AbortSignal.any([request.signal, admission.peer.signal, lifetime.signal]);
        let value;
        switch (input.action) {
          case 'status': value = await monitor.status(); break;
          case 'configure': value = await monitor.configure(input, signal); break;
          case 'disconnect': value = await monitor.disconnect(); break;
          case 'query': value = await monitor.query(input, signal); break;
          default: throw new MonitorError('INVALID_INPUT', 'Unknown monitoring action.');
        }
        return json({ ok: true, value });
      } catch (error) { return json({ ok: false, error: publicError(error) }, 400); }
    },
  }));
  ctx.effect(() => ctx.tools.register({
    name: 'cpamp_monitor',
    description: 'Read the configured CPAMP Full Mode usage monitor. status reports the connection without secrets; query reads aggregate usage or a redacted request page. Never changes CPAMP or connection credentials. Costs are CPAMP estimates in USD, not balance or billed spend. The configured server may include traffic from other clients.',
    parameters: {
      type: 'object', properties: {
        action: { type: 'string', enum: ['status', 'query'] },
        fromMs: { type: 'integer', description: 'Inclusive UTC epoch milliseconds; required for query.' },
        toMs: { type: 'integer', description: 'End epoch milliseconds, later than fromMs; maximum span 32 days.' },
        timeZone: { type: 'string', description: 'IANA time zone, default UTC.' },
        kind: { type: 'string', enum: ['overview', 'events'], description: 'Default overview. events returns up to 50 redacted requests.' },
        beforeMs: { type: 'integer', description: 'Both cursors from the preceding events page are required together.' },
        beforeId: { type: 'integer' },
      }, required: ['action'], additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(input, exec) {
      if (input?.action === 'status') return monitor.status();
      if (input?.action === 'query') return monitor.query(input, exec.signal);
      throw new MonitorError('INVALID_INPUT', 'Only status and query are available to agents.');
    },
    timeoutMs: 30000,
    isConcurrencySafe: () => true,
  }));
}
