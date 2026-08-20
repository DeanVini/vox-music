import { existsSync, readFileSync } from 'node:fs';

function loadEnvFile(): void {
  if (!existsSync('.env')) return;

  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const cut = line.indexOf('=');
    if (cut < 1 || line.trimStart().startsWith('#')) continue;

    const key = line.slice(0, cut).trim();
    if (process.env[key] === undefined) {
      process.env[key] = line.slice(cut + 1).trim();
    }
  }
}

loadEnvFile();

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Falta a variável de ambiente ${key}`);
  return value;
}

async function resolveFfmpeg(): Promise<string> {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;

  try {
    const module = await import('ffmpeg-static');
    const binary = (module.default ?? module) as unknown as string;
    if (typeof binary === 'string' && binary.length > 0) return binary;
  } catch {
    return 'ffmpeg';
  }

  return 'ffmpeg';
}

export const config = {
  livekitUrl: required('LIVEKIT_URL'),
  livekitKey: required('LIVEKIT_API_KEY'),
  livekitSecret: required('LIVEKIT_API_SECRET'),

  ytdlp: process.env.YTDLP_PATH ?? 'yt-dlp',
  ffmpeg: await resolveFfmpeg(),

  identity: process.env.BOT_IDENTITY ?? 'vox-musica',
  displayName: process.env.BOT_NAME ?? 'Vox Música',

  sampleRate: 48000,
  channels: 2,
  samplesPerFrame: 480,
  audioQueueMs: 1000,

  idleMs: Number(process.env.IDLE_MS ?? 5 * 60_000),
  queueLimit: Number(process.env.QUEUE_LIMIT ?? 50),
};

export type Config = typeof config;
