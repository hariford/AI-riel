import type { FastifyReply } from 'fastify';

/** Server-sent events writer on top of Fastify's raw response. */
export class SseWriter {
  constructor(private readonly reply: FastifyReply) {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.flushHeaders?.();
  }

  send(event: unknown): void {
    this.reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  end(): void {
    this.reply.raw.write('data: [DONE]\n\n');
    this.reply.raw.end();
  }
}

export function formatSse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
