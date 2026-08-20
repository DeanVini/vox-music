import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';
import type { Track } from './source.js';

const run = promisify(execFile);

export type Source = 'youtube' | 'soundcloud';

export interface SearchOption extends Track {
  source: Source;
  shortPreview: boolean;
}

const PREFIX: Record<Source, string> = {
  youtube: 'ytsearch',
  soundcloud: 'scsearch',
};

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result.length > 0 ? result : null;
}

function pageOf(data: Record<string, unknown>, source: Source): string | null {
  const direct = text(data.webpage_url) ?? text(data.url);
  if (direct?.startsWith('http')) return direct;

  const id = text(data.id);
  if (!id) return null;

  return source === 'youtube'
    ? `https://www.youtube.com/watch?v=${id}`
    : null;
}

async function searchIn(
  source: Source,
  query: string,
  amount: number,
): Promise<SearchOption[]> {
  const { stdout } = await run(
    config.ytdlp,
    [
      '--no-warnings',
      '--flat-playlist',
      '--dump-json',
      `${PREFIX[source]}${amount}:${query}`,
    ],
    { maxBuffer: 16 * 1024 * 1024, timeout: 25_000 },
  );

  const options: SearchOption[] = [];

  for (const line of stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue;

    const data = JSON.parse(line) as Record<string, unknown>;
    const page = pageOf(data, source);
    if (!page) continue;

    const raw = data.duration;
    const duration = typeof raw === 'number' ? Math.round(raw) : null;

    options.push({
      id: text(data.id) ?? page,
      title: text(data.title) ?? 'Sem título',
      author: text(data.uploader) ?? text(data.channel),
      durationSeconds: duration,
      thumbnail: text(data.thumbnail),
      page,
      source,
      shortPreview:
        source === 'soundcloud' && duration !== null && duration <= 31,
    });
  }

  return options;
}

export async function search(
  query: string,
  options: { perSource?: number; sources?: Source[] } = {},
): Promise<{
  results: SearchOption[];
  failures: Partial<Record<Source, string>>;
}> {
  const term = query.trim();
  if (term.length === 0) return { results: [], failures: {} };

  const sources = options.sources ?? (['youtube', 'soundcloud'] as Source[]);
  const perSource = options.perSource ?? 5;

  const responses = await Promise.allSettled(
    sources.map((source) => searchIn(source, term, perSource)),
  );

  const results: SearchOption[] = [];
  const failures: Partial<Record<Source, string>> = {};

  responses.forEach((response, index) => {
    const source = sources[index]!;

    if (response.status === 'fulfilled') {
      results.push(...response.value);
    } else {
      const cause = response.reason;
      failures[source] =
        cause instanceof Error ? cause.message : 'busca indisponível';
    }
  });

  return { results: interleave(results, sources), failures };
}

function interleave(results: SearchOption[], sources: Source[]): SearchOption[] {
  const bySource = new Map<Source, SearchOption[]>(
    sources.map((s) => [s, results.filter((r) => r.source === s)]),
  );

  const merged: SearchOption[] = [];
  let remaining = true;

  for (let i = 0; remaining; i++) {
    remaining = false;

    for (const source of sources) {
      const item = bySource.get(source)?.[i];
      if (item) {
        merged.push(item);
        remaining = true;
      }
    }
  }

  return merged;
}
