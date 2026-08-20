import { AccessToken } from 'livekit-server-sdk';
import {
  AudioSource,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';
import { AudioEncoding } from '@livekit/rtc-ffi-bindings';
import { config } from './config.js';
import { Reprodutor } from './player.js';
import type { Faixa } from './source.js';

export const TOPICO = 'vox:musica';

export class FilaCheiaError extends Error {
  constructor(readonly limite: number) {
    super(`A fila já tem ${limite} músicas. Espere ou remova alguma.`);
  }
}

export interface ItemDaFila extends Faixa {
  pedidoPor: string;
}

export interface EstadoDaSessao {
  sala: string;
  tocando: ItemDaFila | null;
  fila: ItemDaFila[];
  pausado: boolean;
  volume: number;
  desde: number | null;
}

export class Sessao {
  private readonly fila: ItemDaFila[] = [];
  private atual: ItemDaFila | null = null;
  private pausado = false;
  private desde: number | null = null;
  private laco: Promise<void> | null = null;
  private encerrada = false;
  private relogioDeOciosidade: ReturnType<typeof setTimeout> | null = null;
  private aoSair: (() => void) | null = null;

  private constructor(
    readonly sala: string,
    private readonly room: Room,
    private readonly fonte: AudioSource,
    private readonly reprodutor: Reprodutor,
  ) {}

  static async entrar(sala: string): Promise<Sessao> {
    const token = new AccessToken(config.livekitKey, config.livekitSecret, {
      identity: config.identidade,
      name: config.nome,
      ttl: 24 * 60 * 60,
    });

    token.addGrant({
      room: sala,
      roomJoin: true,
      canPublish: true,
      canSubscribe: false,
      canPublishData: true,
    });

    const room = new Room();
    await room.connect(config.livekitUrl, await token.toJwt(), {
      autoSubscribe: false,
      dynacast: false,
    });

    const fonte = new AudioSource(
      config.taxaAmostragem,
      config.canais,
      config.filaDeAudioMs,
    );

    await room.localParticipant!.publishTrack(
      LocalAudioTrack.createAudioTrack('musica', fonte),
      new TrackPublishOptions({
        source: TrackSource.SOURCE_MICROPHONE,
        dtx: false,
        red: false,
        audioEncoding: new AudioEncoding({ maxBitrate: 128_000n }),
      }),
    );

    const sessao = new Sessao(sala, room, fonte, new Reprodutor(fonte));

    room.on(RoomEvent.ParticipantDisconnected, () => sessao.conferirSala());
    room.on(RoomEvent.ParticipantConnected, () => sessao.cancelarOciosidade());

    sessao.agendarOciosidade();
    return sessao;
  }

  estado(): EstadoDaSessao {
    return {
      sala: this.sala,
      tocando: this.atual,
      fila: [...this.fila],
      pausado: this.pausado,
      volume: this.reprodutor.volumeAtual,
      desde: this.desde,
    };
  }

  adicionar(faixa: Faixa, pedidoPor: string): ItemDaFila {
    const naFrente = this.fila.length + (this.atual ? 1 : 0);
    if (naFrente >= config.limiteDaFila) {
      throw new FilaCheiaError(config.limiteDaFila);
    }

    const item: ItemDaFila = { ...faixa, pedidoPor };
    this.fila.push(item);
    this.cancelarOciosidade();
    this.anunciar();
    this.girar();
    return item;
  }

  pular(): boolean {
    if (!this.atual) return false;
    this.reprodutor.parar();
    return true;
  }

  limpar(): void {
    this.fila.length = 0;
    this.anunciar();
  }

  remover(indice: number): ItemDaFila | null {
    const [removido] = this.fila.splice(indice, 1);
    if (removido) this.anunciar();
    return removido ?? null;
  }

  pausar(valor: boolean): void {
    this.pausado = valor;
    this.reprodutor.definirVolume(valor ? 0 : this.volumeGuardado);
    this.anunciar();
  }

  private volumeGuardado = 1;

  definirVolume(valor: number): void {
    this.volumeGuardado = Math.min(2, Math.max(0, valor));
    if (!this.pausado) this.reprodutor.definirVolume(this.volumeGuardado);
    this.anunciar();
  }

  async sair(): Promise<void> {
    this.encerrada = true;
    this.cancelarOciosidade();
    this.fila.length = 0;
    this.reprodutor.parar();
    await this.laco?.catch(() => undefined);
    await this.fonte.close().catch(() => undefined);
    await this.room.disconnect().catch(() => undefined);
  }

  aoEncerrarSozinha(callback: () => void): void {
    this.aoSair = callback;
  }

  cancelarOciosidade(): void {
    if (!this.relogioDeOciosidade) return;
    clearTimeout(this.relogioDeOciosidade);
    this.relogioDeOciosidade = null;
  }

  agendarOciosidade(): void {
    this.cancelarOciosidade();
    if (this.encerrada) return;

    this.relogioDeOciosidade = setTimeout(() => {
      this.relogioDeOciosidade = null;
      if (this.atual || this.fila.length > 0) return;
      this.aoSair?.();
    }, config.ociosidadeMs);
  }

  conferirSala(): void {
    if (this.encerrada) return;
    if (this.room.remoteParticipants.size > 0) return;

    this.aoSair?.();
  }

  private girar(): void {
    if (this.laco || this.encerrada) return;
    this.laco = this.rodar().finally(() => {
      this.laco = null;
    });
  }

  private async rodar(): Promise<void> {
    while (!this.encerrada) {
      const proximo = this.fila.shift();
      if (!proximo) break;

      this.atual = proximo;
      this.desde = Date.now();
      this.anunciar();

      const resultado = await this.reprodutor.tocar(proximo.pagina);

      if (resultado.motivo === 'erro') {
        this.anunciarErro(proximo, resultado.erro ?? 'falha ao tocar');
      }

      this.atual = null;
      this.desde = null;
      this.anunciar();
    }

    this.agendarOciosidade();
  }

  private anunciar(): void {
    this.enviar({ tipo: 'estado', estado: this.estado() });
  }

  private anunciarErro(item: ItemDaFila, mensagem: string): void {
    this.enviar({ tipo: 'erro', faixa: item.titulo, mensagem });
  }

  private enviar(carga: unknown): void {
    if (this.encerrada) return;

    const dados = new TextEncoder().encode(JSON.stringify(carga));
    void this.room.localParticipant
      ?.publishData(dados, { reliable: true, topic: TOPICO })
      .catch(() => undefined);
  }
}

export class Sessoes {
  private readonly porSala = new Map<string, Sessao>();

  async obter(sala: string): Promise<Sessao> {
    const existente = this.porSala.get(sala);
    if (existente) return existente;

    const nova = await Sessao.entrar(sala);
    this.porSala.set(sala, nova);

    nova.aoEncerrarSozinha(() => {
      if (this.porSala.get(sala) !== nova) return;
      this.porSala.delete(sala);
      void nova.sair();
    });

    return nova;
  }

  atual(sala: string): Sessao | null {
    return this.porSala.get(sala) ?? null;
  }

  listar(): EstadoDaSessao[] {
    return [...this.porSala.values()].map((s) => s.estado());
  }

  async encerrar(sala: string): Promise<boolean> {
    const sessao = this.porSala.get(sala);
    if (!sessao) return false;

    this.porSala.delete(sala);
    await sessao.sair();
    return true;
  }

  async encerrarTudo(): Promise<void> {
    await Promise.all([...this.porSala.keys()].map((s) => this.encerrar(s)));
  }
}
