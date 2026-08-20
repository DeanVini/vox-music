import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import { AudioFrame, AudioSource } from '@livekit/rtc-node';
import { config } from './config.js';
import { argumentosBase } from './source.js';

const BYTES_POR_AMOSTRA = 2;
const BYTES_POR_QUADRO =
  config.amostrasPorQuadro * config.canais * BYTES_POR_AMOSTRA;

export interface ResultadoDaReproducao {
  motivo: 'fim' | 'parado' | 'erro';
  erro?: string;
}

export class Reprodutor {
  private ytdlp: ChildProcess | null = null;
  private ffmpeg: ChildProcess | null = null;
  private parando = false;
  private volume = 1;

  constructor(private readonly fonte: AudioSource) {}

  definirVolume(valor: number): void {
    this.volume = Math.min(2, Math.max(0, valor));
  }

  get volumeAtual(): number {
    return this.volume;
  }

  parar(): void {
    this.parando = true;
    this.ytdlp?.kill('SIGKILL');
    this.ffmpeg?.kill('SIGKILL');
    this.fonte.clearQueue();
  }

  async tocar(pagina: string): Promise<ResultadoDaReproducao> {
    this.parando = false;

    const ytdlp = spawn(
      config.ytdlp,
      [...argumentosBase(), '-o', '-', pagina],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const ffmpeg = spawn(
      config.ffmpeg,
      [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-vn',
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        '-ar', String(config.taxaAmostragem),
        '-ac', String(config.canais),
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    this.ytdlp = ytdlp;
    this.ffmpeg = ffmpeg;

    const saidaDoYtdlp = ytdlp.stdout as Readable;
    const saidaDoFfmpeg = ffmpeg.stdout as Readable;

    saidaDoYtdlp.pipe(ffmpeg.stdin!);

    let erroDeFfmpeg = '';
    ffmpeg.stderr!.on('data', (d: Buffer) => {
      erroDeFfmpeg += d.toString();
    });

    let erroDeYtdlp = '';
    ytdlp.stderr!.on('data', (d: Buffer) => {
      erroDeYtdlp += d.toString();
    });

    saidaDoYtdlp.on('error', () => undefined);
    ffmpeg.stdin!.on('error', () => undefined);

    try {
      await this.bombear(saidaDoFfmpeg);
    } catch (causa) {
      this.encerrar();
      return {
        motivo: 'erro',
        erro: motivoDetalhado(causa, erroDeYtdlp, erroDeFfmpeg),
      };
    }

    const saiuComErro = await new Promise<number | null>((resolve) => {
      if (ffmpeg.exitCode !== null) return resolve(ffmpeg.exitCode);
      ffmpeg.once('close', (codigo) => resolve(codigo));
    });

    this.encerrar();

    if (this.parando) return { motivo: 'parado' };

    if (saiuComErro !== 0 && saiuComErro !== null) {
      const detalhe = (erroDeYtdlp + erroDeFfmpeg).trim().split('\n').at(-1);
      return { motivo: 'erro', erro: detalhe ?? 'falha ao decodificar' };
    }

    return { motivo: 'fim' };
  }

  private async bombear(saida: Readable): Promise<void> {
    let sobra: Uint8Array = new Uint8Array(0);

    for await (const pedaco of saida) {
      if (this.parando) return;

      const bloco = pedaco as Uint8Array;
      if (sobra.length === 0) {
        sobra = bloco;
      } else {
        const junto = new Uint8Array(sobra.length + bloco.length);
        junto.set(sobra, 0);
        junto.set(bloco, sobra.length);
        sobra = junto;
      }

      while (sobra.length >= BYTES_POR_QUADRO) {
        const bloco = sobra.subarray(0, BYTES_POR_QUADRO);
        sobra = sobra.subarray(BYTES_POR_QUADRO);

        await this.enviar(bloco);
        if (this.parando) return;
      }
    }
  }

  private async enviar(bloco: Uint8Array): Promise<void> {
    const amostras = new Int16Array(
      bloco.buffer.slice(
        bloco.byteOffset,
        bloco.byteOffset + bloco.byteLength,
      ),
    );

    if (this.volume !== 1) {
      for (let i = 0; i < amostras.length; i++) {
        const v = Math.round(amostras[i]! * this.volume);
        amostras[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
      }
    }

    await this.fonte.captureFrame(
      new AudioFrame(
        amostras,
        config.taxaAmostragem,
        config.canais,
        config.amostrasPorQuadro,
      ),
    );
  }

  private encerrar(): void {
    this.ytdlp?.kill('SIGKILL');
    this.ffmpeg?.kill('SIGKILL');
    this.ytdlp = null;
    this.ffmpeg = null;
  }
}

function motivoDetalhado(
  causa: unknown,
  ytdlp: string,
  ffmpeg: string,
): string {
  const nativo = causa instanceof Error ? causa.message : String(causa);
  const externo = (ytdlp + ffmpeg).trim().split('\n').at(-1);
  return externo && externo.length > 0 ? externo : nativo;
}
