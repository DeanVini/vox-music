import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';

const run = promisify(execFile);

export interface Track {
  id: string;
  title: string;
  author: string | null;
  durationSeconds: number | null;
  thumbnail: string | null;
  page: string;
  source: 'youtube' | 'soundcloud' | 'other';
}

const URL_LIKE = /^https?:\/\//i;

function targetFor(query: string): string {
  const text = query.trim();
  return URL_LIKE.test(text) ? text : `ytsearch1:${text}`;
}

function sourceOf(extractor: string): Track['source'] {
  if (extractor.startsWith('youtube')) return 'youtube';
  if (extractor.startsWith('soundcloud')) return 'soundcloud';
  return 'other';
}

function firstObject(output: string): Record<string, unknown> {
  for (const line of output.split('\n')) {
    const text = line.trim();
    if (!text.startsWith('{')) continue;

    const parsed = JSON.parse(text) as Record<string, unknown>;
    const entries = parsed.entries as Record<string, unknown>[] | undefined;

    if (Array.isArray(entries) && entries.length > 0) return entries[0]!;
    return parsed;
  }

  throw new Error('Nada encontrado para essa busca');
}

export function baseArgs(): string[] {
  return [
    '--js-runtimes',
    'node',
    '--no-playlist',
    '--no-warnings',
    '-f',
    'bestaudio/best',
  ];
}

export async function resolve(query: string): Promise<Track> {
  const { stdout } = await run(
    config.ytdlp,
    [...baseArgs(), '--dump-json', targetFor(query)],
    { maxBuffer: 32 * 1024 * 1024, timeout: 45_000 },
  );

  const data = firstObject(stdout);
  const duration = data.duration;

  return {
    id: String(data.id ?? ''),
    title: String(data.title ?? 'Sem título'),
    author: data.uploader ? String(data.uploader) : null,
    durationSeconds: typeof duration === 'number' ? Math.round(duration) : null,
    thumbnail: data.thumbnail ? String(data.thumbnail) : null,
    page: String(data.webpage_url ?? data.original_url ?? query),
    source: sourceOf(String(data.extractor ?? '')),
  };
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'ao vivo';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
