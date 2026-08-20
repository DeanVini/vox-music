import { existsSync, readFileSync } from 'node:fs';

function carregarEnv(): void {
  if (!existsSync('.env')) return;

  for (const linha of readFileSync('.env', 'utf8').split('\n')) {
    const corte = linha.indexOf('=');
    if (corte < 1 || linha.trimStart().startsWith('#')) continue;

    const chave = linha.slice(0, corte).trim();
    if (process.env[chave] === undefined) {
      process.env[chave] = linha.slice(corte + 1).trim();
    }
  }
}

carregarEnv();

function obrigatorio(chave: string): string {
  const valor = process.env[chave];
  if (!valor) throw new Error(`Falta a variável de ambiente ${chave}`);
  return valor;
}

async function acharFfmpeg(): Promise<string> {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;

  try {
    const mod = await import('ffmpeg-static');
    const caminho = (mod.default ?? mod) as unknown as string;
    if (typeof caminho === 'string' && caminho.length > 0) return caminho;
  } catch {
    // sem o pacote, cai no binário do sistema
  }

  return 'ffmpeg';
}

export const config = {
  livekitUrl: obrigatorio('LIVEKIT_URL'),
  livekitKey: obrigatorio('LIVEKIT_API_KEY'),
  livekitSecret: obrigatorio('LIVEKIT_API_SECRET'),

  ytdlp: process.env.YTDLP_PATH ?? 'yt-dlp',
  ffmpeg: await acharFfmpeg(),

  identidade: process.env.BOT_IDENTITY ?? 'vox-musica',
  nome: process.env.BOT_NAME ?? 'Vox Música',

  taxaAmostragem: 48000,
  canais: 2,
  amostrasPorQuadro: 480,
  filaDeAudioMs: 1000,

  ociosidadeMs: Number(process.env.OCIOSIDADE_MS ?? 5 * 60_000),
  limiteDaFila: Number(process.env.LIMITE_DA_FILA ?? 50),
};

export type Config = typeof config;
