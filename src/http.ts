import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { search, type Source } from './search.js';
import { resolve } from './source.js';
import { QueueFullError, type Sessions } from './session.js';

interface Context {
  sessions: Sessions;
  secret: string | null;
}

class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = [];
  for await (const p of req) parts.push(p as Buffer);
  if (parts.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    throw new RequestError(400, 'Corpo inválido: esperava JSON');
  }
}

function reply(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RequestError(400, `Campo obrigatório: ${field}`);
  }
  return value.trim();
}

export function createHttpServer(ctx: Context) {
  return createServer((req, res) => {
    void handle(ctx, req, res).catch((cause) => {
      if (cause instanceof RequestError) {
        reply(res, cause.status, { error: cause.message });
        return;
      }

      if (cause instanceof QueueFullError) {
        reply(res, 409, { error: cause.message });
        return;
      }

      const message = cause instanceof Error ? cause.message : String(cause);
      reply(res, 500, { error: message });
    });
  });
}

async function handle(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://internal');
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/health') {
    reply(res, 200, { ok: true, rooms: ctx.sessions.list().length });
    return;
  }

  if (ctx.secret && req.headers.authorization !== `Bearer ${ctx.secret}`) {
    reply(res, 401, { error: 'Não autorizado' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/rooms') {
    reply(res, 200, { rooms: ctx.sessions.list() });
    return;
  }

  if (parts[0] !== 'rooms' || !parts[1]) {
    reply(res, 404, { error: 'Rota desconhecida' });
    return;
  }

  const roomName = decodeURIComponent(parts[1]);
  const action = parts[2];

  if (req.method === 'GET' && !action) {
    reply(res, 200, { state: ctx.sessions.current(roomName)?.state() ?? null });
    return;
  }

  if (req.method === 'DELETE' && !action) {
    reply(res, 200, { left: await ctx.sessions.close(roomName) });
    return;
  }

  if (req.method === 'POST' && action === 'search') {
    const body = await readBody(req);
    const query = requireText(body.query, 'query');
    const sources = Array.isArray(body.sources)
      ? (body.sources as Source[])
      : undefined;

    const { results, failures } = await search(query, {
      perSource: Number(body.perSource ?? 5),
      sources,
    });

    reply(res, 200, { results, failures });
    return;
  }

  if (req.method === 'POST' && action === 'play') {
    const body = await readBody(req);
    const target = requireText(body.page ?? body.query, 'page ou query');
    const requestedBy = requireText(body.requestedBy ?? 'alguém', 'requestedBy');

    const track = await resolve(target);
    const session = await ctx.sessions.get(roomName);
    const item = session.add(track, requestedBy);

    reply(res, 200, { added: item, state: session.state() });
    return;
  }

  const session = ctx.sessions.current(roomName);
  if (!session) {
    reply(res, 404, { error: 'Nenhuma sessão nessa sala' });
    return;
  }

  if (req.method === 'POST' && action === 'skip') {
    reply(res, 200, { skipped: session.skip(), state: session.state() });
    return;
  }

  if (req.method === 'POST' && action === 'pause') {
    const body = await readBody(req);
    session.pause(body.paused !== false);
    reply(res, 200, { state: session.state() });
    return;
  }

  if (req.method === 'POST' && action === 'volume') {
    const body = await readBody(req);
    const value = Number(body.volume);

    if (!Number.isFinite(value)) {
      throw new RequestError(400, 'volume precisa ser um número entre 0 e 2');
    }

    session.setVolume(value);
    reply(res, 200, { state: session.state() });
    return;
  }

  if (req.method === 'POST' && action === 'clear') {
    session.clear();
    reply(res, 200, { state: session.state() });
    return;
  }

  if (req.method === 'DELETE' && action === 'queue' && parts[3]) {
    const index = Number(parts[3]);

    if (!Number.isInteger(index) || index < 0) {
      throw new RequestError(400, 'índice inválido');
    }

    const removed = session.remove(index);
    reply(res, removed ? 200 : 404, { removed, state: session.state() });
    return;
  }

  reply(res, 404, { error: 'Rota desconhecida' });
}
