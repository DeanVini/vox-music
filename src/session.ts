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
import { Player } from './player.js';
import type { Track } from './source.js';

export const TOPIC = 'vox:musica';

export class QueueFullError extends Error {
  constructor(readonly limit: number) {
    super(`A fila já tem ${limit} músicas. Espere ou remova alguma.`);
  }
}

export interface QueueItem extends Track {
  requestedBy: string;
}

export interface SessionState {
  room: string;
  playing: QueueItem | null;
  queue: QueueItem[];
  paused: boolean;
  volume: number;
  since: number | null;
}

export class Session {
  private readonly queue: QueueItem[] = [];
  private current: QueueItem | null = null;
  private paused = false;
  private since: number | null = null;
  private loop: Promise<void> | null = null;
  private closed = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onLeave: (() => void) | null = null;
  private storedVolume = 1;

  private constructor(
    readonly roomName: string,
    private readonly room: Room,
    private readonly source: AudioSource,
    private readonly player: Player,
  ) {}

  static async join(roomName: string): Promise<Session> {
    const token = new AccessToken(config.livekitKey, config.livekitSecret, {
      identity: config.identity,
      name: config.displayName,
      ttl: 24 * 60 * 60,
    });

    token.addGrant({
      room: roomName,
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

    const source = new AudioSource(
      config.sampleRate,
      config.channels,
      config.audioQueueMs,
    );

    await room.localParticipant!.publishTrack(
      LocalAudioTrack.createAudioTrack('musica', source),
      new TrackPublishOptions({
        source: TrackSource.SOURCE_MICROPHONE,
        dtx: false,
        red: false,
        audioEncoding: new AudioEncoding({ maxBitrate: 128_000n }),
      }),
    );

    const session = new Session(roomName, room, source, new Player(source));

    room.on(RoomEvent.ParticipantDisconnected, () => session.checkRoom());
    room.on(RoomEvent.ParticipantConnected, () => session.cancelIdle());

    session.scheduleIdle();
    return session;
  }

  state(): SessionState {
    return {
      room: this.roomName,
      playing: this.current,
      queue: [...this.queue],
      paused: this.paused,
      volume: this.player.currentVolume,
      since: this.since,
    };
  }

  add(track: Track, requestedBy: string): QueueItem {
    const ahead = this.queue.length + (this.current ? 1 : 0);
    if (ahead >= config.queueLimit) {
      throw new QueueFullError(config.queueLimit);
    }

    const item: QueueItem = { ...track, requestedBy };
    this.queue.push(item);
    this.cancelIdle();
    this.announce();
    this.spin();
    return item;
  }

  skip(): boolean {
    if (!this.current) return false;
    this.player.stop();
    return true;
  }

  clear(): void {
    this.queue.length = 0;
    this.announce();
  }

  remove(index: number): QueueItem | null {
    const [removed] = this.queue.splice(index, 1);
    if (removed) this.announce();
    return removed ?? null;
  }

  pause(value: boolean): void {
    this.paused = value;
    this.player.setVolume(value ? 0 : this.storedVolume);
    this.announce();
  }

  setVolume(value: number): void {
    this.storedVolume = Math.min(2, Math.max(0, value));
    if (!this.paused) this.player.setVolume(this.storedVolume);
    this.announce();
  }

  async leave(): Promise<void> {
    this.closed = true;
    this.cancelIdle();
    this.queue.length = 0;
    this.player.stop();
    await this.loop?.catch(() => undefined);
    await this.source.close().catch(() => undefined);
    await this.room.disconnect().catch(() => undefined);
  }

  onSelfClose(callback: () => void): void {
    this.onLeave = callback;
  }

  cancelIdle(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  scheduleIdle(): void {
    this.cancelIdle();
    if (this.closed) return;

    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.current || this.queue.length > 0) return;
      this.onLeave?.();
    }, config.idleMs);
  }

  checkRoom(): void {
    if (this.closed) return;
    if (this.room.remoteParticipants.size > 0) return;

    this.onLeave?.();
  }

  private spin(): void {
    if (this.loop || this.closed) return;
    this.loop = this.run().finally(() => {
      this.loop = null;
    });
  }

  private async run(): Promise<void> {
    while (!this.closed) {
      const next = this.queue.shift();
      if (!next) break;

      this.current = next;
      this.since = Date.now();
      this.announce();

      const result = await this.player.play(next.page);

      if (result.reason === 'error') {
        this.announceError(next, result.error ?? 'falha ao tocar');
      }

      this.current = null;
      this.since = null;
      this.announce();
    }

    this.scheduleIdle();
  }

  private announce(): void {
    this.publish({ type: 'state', state: this.state() });
  }

  private announceError(item: QueueItem, message: string): void {
    this.publish({ type: 'error', track: item.title, message });
  }

  private publish(payload: unknown): void {
    if (this.closed) return;

    const data = new TextEncoder().encode(JSON.stringify(payload));
    void this.room.localParticipant
      ?.publishData(data, { reliable: true, topic: TOPIC })
      .catch(() => undefined);
  }
}

export class Sessions {
  private readonly byRoom = new Map<string, Session>();

  async get(roomName: string): Promise<Session> {
    const existing = this.byRoom.get(roomName);
    if (existing) return existing;

    const created = await Session.join(roomName);
    this.byRoom.set(roomName, created);

    created.onSelfClose(() => {
      if (this.byRoom.get(roomName) !== created) return;
      this.byRoom.delete(roomName);
      void created.leave();
    });

    return created;
  }

  current(roomName: string): Session | null {
    return this.byRoom.get(roomName) ?? null;
  }

  list(): SessionState[] {
    return [...this.byRoom.values()].map((s) => s.state());
  }

  async close(roomName: string): Promise<boolean> {
    const session = this.byRoom.get(roomName);
    if (!session) return false;

    this.byRoom.delete(roomName);
    await session.leave();
    return true;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.byRoom.keys()].map((r) => this.close(r)));
  }
}
