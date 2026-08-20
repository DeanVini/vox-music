import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { buscar, type Fonte } from './search.js';
import { resolver } from './source.js';
import type { Sessoes } from './session.js';

interface Contexto {
  sessoes: Sessoes;
  segredo: string | null;
}

async function corpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  const partes: Buffer[] = [];
  for await (const p of req) partes.push(p as Buffer);
  if (partes.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new ErroDePedido(400, 'Corpo inválido: esperava JSON');
  }
}

class ErroDePedido extends Error {
  constructor(readonly status: number, mensagem: string) {
    super(mensagem);
  }
}

function responder(res: ServerResponse, status: number, dados: unknown): void {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(corpo),
  });
  res.end(corpo);
}

function texto(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.trim().length === 0) {
    throw new ErroDePedido(400, `Campo obrigatório: ${campo}`);
  }
  return valor.trim();
}

export function criarServidor(ctx: Contexto) {
  return createServer((req, res) => {
    void atender(ctx, req, res).catch((causa) => {
      if (causa instanceof ErroDePedido) {
        responder(res, causa.status, { erro: causa.message });
        return;
      }

      const mensagem = causa instanceof Error ? causa.message : String(causa);
      responder(res, 500, { erro: mensagem });
    });
  });
}

async function atender(
  ctx: Contexto,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://interno');
  const partes = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/saude') {
    responder(res, 200, { ok: true, salas: ctx.sessoes.listar().length });
    return;
  }

  if (ctx.segredo && req.headers.authorization !== `Bearer ${ctx.segredo}`) {
    responder(res, 401, { erro: 'Não autorizado' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/salas') {
    responder(res, 200, { salas: ctx.sessoes.listar() });
    return;
  }

  if (partes[0] !== 'salas' || !partes[1]) {
    responder(res, 404, { erro: 'Rota desconhecida' });
    return;
  }

  const sala = decodeURIComponent(partes[1]);
  const acao = partes[2];

  if (req.method === 'GET' && !acao) {
    const sessao = ctx.sessoes.atual(sala);
    responder(res, 200, { estado: sessao?.estado() ?? null });
    return;
  }

  if (req.method === 'DELETE' && !acao) {
    responder(res, 200, { saiu: await ctx.sessoes.encerrar(sala) });
    return;
  }

  if (req.method === 'POST' && acao === 'buscar') {
    const dados = await corpo(req);
    const consulta = texto(dados.consulta, 'consulta');
    const fontes = Array.isArray(dados.fontes)
      ? (dados.fontes as Fonte[])
      : undefined;

    const { resultados, falhas } = await buscar(consulta, {
      porFonte: Number(dados.porFonte ?? 5),
      fontes,
    });

    responder(res, 200, { resultados, falhas });
    return;
  }

  if (req.method === 'POST' && acao === 'tocar') {
    const dados = await corpo(req);
    const alvo = texto(dados.pagina ?? dados.consulta, 'pagina ou consulta');
    const pedidoPor = texto(dados.pedidoPor ?? 'alguém', 'pedidoPor');

    const faixa = await resolver(alvo);
    const sessao = await ctx.sessoes.obter(sala);
    const item = sessao.adicionar(faixa, pedidoPor);

    responder(res, 200, { adicionado: item, estado: sessao.estado() });
    return;
  }

  const sessao = ctx.sessoes.atual(sala);
  if (!sessao) {
    responder(res, 404, { erro: 'Nenhuma sessão nessa sala' });
    return;
  }

  if (req.method === 'POST' && acao === 'pular') {
    responder(res, 200, { pulou: sessao.pular(), estado: sessao.estado() });
    return;
  }

  if (req.method === 'POST' && acao === 'pausar') {
    const dados = await corpo(req);
    sessao.pausar(dados.pausado !== false);
    responder(res, 200, { estado: sessao.estado() });
    return;
  }

  if (req.method === 'POST' && acao === 'volume') {
    const dados = await corpo(req);
    const valor = Number(dados.volume);

    if (!Number.isFinite(valor)) {
      throw new ErroDePedido(400, 'volume precisa ser um número entre 0 e 2');
    }

    sessao.definirVolume(valor);
    responder(res, 200, { estado: sessao.estado() });
    return;
  }

  if (req.method === 'POST' && acao === 'limpar') {
    sessao.limpar();
    responder(res, 200, { estado: sessao.estado() });
    return;
  }

  if (req.method === 'DELETE' && acao === 'fila' && partes[3]) {
    const indice = Number(partes[3]);

    if (!Number.isInteger(indice) || indice < 0) {
      throw new ErroDePedido(400, 'índice inválido');
    }

    const removido = sessao.remover(indice);
    responder(res, removido ? 200 : 404, {
      removido,
      estado: sessao.estado(),
    });
    return;
  }

  responder(res, 404, { erro: 'Rota desconhecida' });
}
