import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';
import type { Faixa } from './source.js';

const executar = promisify(execFile);

export type Fonte = 'youtube' | 'soundcloud';

export interface Opcao extends Faixa {
  origem: Fonte;
  previaCurta: boolean;
}

const PREFIXO: Record<Fonte, string> = {
  youtube: 'ytsearch',
  soundcloud: 'scsearch',
};

function texto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  return s.length > 0 ? s : null;
}

function paginaDe(dados: Record<string, unknown>, fonte: Fonte): string | null {
  const direto = texto(dados.webpage_url) ?? texto(dados.url);
  if (direto?.startsWith('http')) return direto;

  const id = texto(dados.id);
  if (!id) return null;

  return fonte === 'youtube' ? `https://www.youtube.com/watch?v=${id}` : null;
}

async function buscarEm(
  fonte: Fonte,
  consulta: string,
  quantidade: number,
): Promise<Opcao[]> {
  const { stdout } = await executar(
    config.ytdlp,
    [
      '--no-warnings',
      '--flat-playlist',
      '--dump-json',
      `${PREFIXO[fonte]}${quantidade}:${consulta}`,
    ],
    { maxBuffer: 16 * 1024 * 1024, timeout: 25_000 },
  );

  const opcoes: Opcao[] = [];

  for (const linha of stdout.split('\n')) {
    if (!linha.trim().startsWith('{')) continue;

    const dados = JSON.parse(linha) as Record<string, unknown>;
    const pagina = paginaDe(dados, fonte);
    if (!pagina) continue;

    const bruta = dados.duration;
    const duracao = typeof bruta === 'number' ? Math.round(bruta) : null;

    opcoes.push({
      id: texto(dados.id) ?? pagina,
      titulo: texto(dados.title) ?? 'Sem título',
      autor: texto(dados.uploader) ?? texto(dados.channel),
      duracaoSegundos: duracao,
      miniatura: texto(dados.thumbnail),
      pagina,
      origem: fonte,
      previaCurta: fonte === 'soundcloud' && duracao !== null && duracao <= 31,
    });
  }

  return opcoes;
}

export async function buscar(
  consulta: string,
  opcoes: { porFonte?: number; fontes?: Fonte[] } = {},
): Promise<{ resultados: Opcao[]; falhas: Partial<Record<Fonte, string>> }> {
  const termo = consulta.trim();
  if (termo.length === 0) return { resultados: [], falhas: {} };

  const fontes = opcoes.fontes ?? (['youtube', 'soundcloud'] as Fonte[]);
  const porFonte = opcoes.porFonte ?? 5;

  const respostas = await Promise.allSettled(
    fontes.map((fonte) => buscarEm(fonte, termo, porFonte)),
  );

  const resultados: Opcao[] = [];
  const falhas: Partial<Record<Fonte, string>> = {};

  respostas.forEach((resposta, indice) => {
    const fonte = fontes[indice]!;

    if (resposta.status === 'fulfilled') {
      resultados.push(...resposta.value);
    } else {
      const causa = resposta.reason;
      falhas[fonte] =
        causa instanceof Error ? causa.message : 'busca indisponível';
    }
  });

  return { resultados: intercalar(resultados, fontes), falhas };
}

function intercalar(resultados: Opcao[], fontes: Fonte[]): Opcao[] {
  const porOrigem = new Map<Fonte, Opcao[]>(
    fontes.map((f) => [f, resultados.filter((r) => r.origem === f)]),
  );

  const juntos: Opcao[] = [];
  let restam = true;

  for (let i = 0; restam; i++) {
    restam = false;

    for (const fonte of fontes) {
      const item = porOrigem.get(fonte)?.[i];
      if (item) {
        juntos.push(item);
        restam = true;
      }
    }
  }

  return juntos;
}
