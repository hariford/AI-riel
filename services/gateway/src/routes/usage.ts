import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import type { UsageStore } from '../usage-store.js';

const Range = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function range(q: unknown) {
  const r = Range.parse(q);
  const to = r.to ?? new Date();
  const from = r.from ?? new Date(to.getTime() - 30 * 24 * 3600 * 1000);
  return { from, to };
}

export function registerUsageRoutes(app: FastifyInstance, usage: UsageStore): void {
  /** The signed-in user's own usage. */
  app.get('/v1/usage/me', async (req) => {
    const { from, to } = range(req.query);
    return { from, to, rows: await usage.summary({ from, to, userId: req.user.id }) };
  });

  /** Organisation-wide usage; admins only. */
  app.get('/v1/usage/summary', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { from, to } = range(req.query);
    return { from, to, rows: await usage.summary({ from, to }) };
  });

  app.get('/v1/usage/summary.csv', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { from, to } = range(req.query);
    const rows = await usage.summary({ from, to });
    const header = 'day,userId,userName,model,requests,promptTokens,completionTokens,cachedTokens';
    const lines = rows.map((r) =>
      [r.day, r.userId, csv(r.userName), r.model, r.requests, r.promptTokens, r.completionTokens, r.cachedTokens].join(','),
    );
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="airiel-usage.csv"');
    return [header, ...lines].join('\n');
  });
}

const csv = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
