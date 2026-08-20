import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';

const executar = promisify(execFile);

export interface Faixa {
  id: string;
  titulo: string;
  autor: string | null;
  duracaoSegundos: number | null;
  miniatura: string | null;
  pagina: string;
  origem: 'youtube' | 'soundcloud' | 'outra';
}

const ENDERECO = /^https?:\/\//i;

function alvoDe(consulta: string): string {
  const texto = consulta.trim();
  if (ENDERECO.test(texto)) return texto;
  return `ytsearch1:${texto}`;
}

function origemDe(extrator: string): Faixa['origem'] {
  if (extrator.startsWith('youtube')) return 'youtube';
  if (extrator.startsWith('soundcloud')) return 'soundcloud';
  return 'outra';
}

function primeiroObjeto(saida: string): Record<string, unknown> {
  for (const linha of saida.split('\n')) {
    const texto = linha.trim();
    if (!texto.startsWith('{')) continue;

    const objeto = JSON.parse(texto) as Record<string, unknown>;
    const entradas = objeto.entries as Record<string, unknown>[] | undefined;

    if (Array.isArray(entradas) && entradas.length > 0) return entradas[0]!;
    return objeto;
  }

  throw new Error('Nada encontrado para essa busca');
}

export function argumentosBase(): string[] {
  return [
    '--js-runtimes',
    'node',
    '--no-playlist',
    '--no-warnings',
    '-f',
    'bestaudio/best',
  ];
}

export async function resolver(consulta: string): Promise<Faixa> {
  const { stdout } = await executar(
    config.ytdlp,
    [...argumentosBase(), '--dump-json', alvoDe(consulta)],
    { maxBuffer: 32 * 1024 * 1024, timeout: 45_000 },
  );

  const dados = primeiroObjeto(stdout);
  const duracao = dados.duration;

  return {
    id: String(dados.id ?? ''),
    titulo: String(dados.title ?? 'Sem título'),
    autor: dados.uploader ? String(dados.uploader) : null,
    duracaoSegundos: typeof duracao === 'number' ? Math.round(duracao) : null,
    miniatura: dados.thumbnail ? String(dados.thumbnail) : null,
    pagina: String(dados.webpage_url ?? dados.original_url ?? consulta),
    origem: origemDe(String(dados.extractor ?? '')),
  };
}

export function duracaoLegivel(segundos: number | null): string {
  if (segundos === null) return 'ao vivo';

  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
