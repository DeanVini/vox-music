import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import { AudioFrame, AudioSource } from '@livekit/rtc-node';
import { config } from './config.js';
import { baseArgs } from './source.js';

const BYTES_PER_SAMPLE = 2;
const BYTES_PER_FRAME =
  config.samplesPerFrame * config.channels * BYTES_PER_SAMPLE;

export interface PlaybackResult {
  reason: 'finished' | 'stopped' | 'error';
  error?: string;
}

export class Player {
  private ytdlp: ChildProcess | null = null;
  private ffmpeg: ChildProcess | null = null;
  private stopping = false;
  private volume = 1;

  constructor(private readonly source: AudioSource) {}

  setVolume(value: number): void {
    this.volume = Math.min(2, Math.max(0, value));
  }

  get currentVolume(): number {
    return this.volume;
  }

  stop(): void {
    this.stopping = true;
    this.ytdlp?.kill('SIGKILL');
    this.ffmpeg?.kill('SIGKILL');
    this.source.clearQueue();
  }

  async play(page: string): Promise<PlaybackResult> {
    this.stopping = false;

    const ytdlp = spawn(config.ytdlp, [...baseArgs(), '-o', '-', page], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const ffmpeg = spawn(
      config.ffmpeg,
      [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-vn',
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        '-ar', String(config.sampleRate),
        '-ac', String(config.channels),
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    this.ytdlp = ytdlp;
    this.ffmpeg = ffmpeg;

    const ytdlpOut = ytdlp.stdout as Readable;
    const ffmpegOut = ffmpeg.stdout as Readable;

    ytdlpOut.pipe(ffmpeg.stdin!);

    let ffmpegErrors = '';
    ffmpeg.stderr!.on('data', (d: Buffer) => {
      ffmpegErrors += d.toString();
    });

    let ytdlpErrors = '';
    ytdlp.stderr!.on('data', (d: Buffer) => {
      ytdlpErrors += d.toString();
    });

    ytdlpOut.on('error', () => undefined);
    ffmpeg.stdin!.on('error', () => undefined);

    try {
      await this.pump(ffmpegOut);
    } catch (cause) {
      this.cleanup();
      return {
        reason: 'error',
        error: describeFailure(cause, ytdlpErrors, ffmpegErrors),
      };
    }

    const exitCode = await new Promise<number | null>((resolve) => {
      if (ffmpeg.exitCode !== null) return resolve(ffmpeg.exitCode);
      ffmpeg.once('close', (code) => resolve(code));
    });

    this.cleanup();

    if (this.stopping) return { reason: 'stopped' };

    if (exitCode !== 0 && exitCode !== null) {
      const detail = (ytdlpErrors + ffmpegErrors).trim().split('\n').at(-1);
      return { reason: 'error', error: detail ?? 'falha ao decodificar' };
    }

    return { reason: 'finished' };
  }

  private async pump(output: Readable): Promise<void> {
    let leftover: Uint8Array = new Uint8Array(0);

    for await (const chunk of output) {
      if (this.stopping) return;

      const block = chunk as Uint8Array;
      if (leftover.length === 0) {
        leftover = block;
      } else {
        const merged = new Uint8Array(leftover.length + block.length);
        merged.set(leftover, 0);
        merged.set(block, leftover.length);
        leftover = merged;
      }

      while (leftover.length >= BYTES_PER_FRAME) {
        const frame = leftover.subarray(0, BYTES_PER_FRAME);
        leftover = leftover.subarray(BYTES_PER_FRAME);

        await this.send(frame);
        if (this.stopping) return;
      }
    }
  }

  private async send(block: Uint8Array): Promise<void> {
    const samples = new Int16Array(
      block.buffer.slice(block.byteOffset, block.byteOffset + block.byteLength),
    );

    if (this.volume !== 1) {
      for (let i = 0; i < samples.length; i++) {
        const scaled = Math.round(samples[i]! * this.volume);
        samples[i] = scaled > 32767 ? 32767 : scaled < -32768 ? -32768 : scaled;
      }
    }

    await this.source.captureFrame(
      new AudioFrame(
        samples,
        config.sampleRate,
        config.channels,
        config.samplesPerFrame,
      ),
    );
  }

  private cleanup(): void {
    this.ytdlp?.kill('SIGKILL');
    this.ffmpeg?.kill('SIGKILL');
    this.ytdlp = null;
    this.ffmpeg = null;
  }
}

function describeFailure(
  cause: unknown,
  ytdlp: string,
  ffmpeg: string,
): string {
  const native = cause instanceof Error ? cause.message : String(cause);
  const external = (ytdlp + ffmpeg).trim().split('\n').at(-1);
  return external && external.length > 0 ? external : native;
}
