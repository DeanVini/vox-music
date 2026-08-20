import { AccessToken } from 'livekit-server-sdk';
import {
  AudioFrame, AudioSource, AudioStream, LocalAudioTrack,
  Room, RoomEvent, TrackPublishOptions, TrackSource,
} from '@livekit/rtc-node';
import { AudioEncoding } from '@livekit/rtc-ffi-bindings';
import { config } from './config.js';

const SALA = `estereo-${Date.now()}`;

async function token(id: string, pub: boolean): Promise<string> {
  const t = new AccessToken(config.livekitKey, config.livekitSecret, { identity: id, ttl: 600 });
  t.addGrant({ room: SALA, roomJoin: true, canPublish: pub, canSubscribe: true });
  return t.toJwt();
}

async function main(): Promise<void> {
  const ouvinte = new Room();
  let difMax = 0;
  let canais = 0;
  let n = 0;

  ouvinte.on(RoomEvent.TrackSubscribed, (track) => {
    void (async () => {
      for await (const q of new AudioStream(track, { numChannels: 2, sampleRate: 48000 })) {
        canais = q.channels;
        if (q.channels < 2) continue;
        const d = q.data;
        for (let i = 0; i + 1 < d.length; i += 2) {
          const dif = Math.abs(d[i]! - d[i + 1]!);
          if (dif > difMax) difMax = dif;
          n++;
        }
      }
    })();
  });

  await ouvinte.connect(config.livekitUrl, await token('ouvinte', false), { autoSubscribe: true, dynacast: false });

  const bot = new Room();
  await bot.connect(config.livekitUrl, await token('bot', true), { autoSubscribe: false, dynacast: false });

  const fonte = new AudioSource(48000, 2, 1000);
  await bot.localParticipant!.publishTrack(
    LocalAudioTrack.createAudioTrack('musica', fonte),
    new TrackPublishOptions({
      source: TrackSource.SOURCE_MICROPHONE,
      dtx: false,
      red: false,
      audioEncoding: new AudioEncoding({ maxBitrate: 128000n }),
    }),
  );

  // esquerda 440 Hz, direita silencio: se chegar estereo, a diferenca e enorme
  let fase = 0;
  for (let k = 0; k < 400; k++) {
    const dados = new Int16Array(480 * 2);
    for (let i = 0; i < 480; i++) {
      dados[i * 2] = Math.round(Math.sin(fase) * 15000);
      dados[i * 2 + 1] = 0;
      fase += (2 * Math.PI * 440) / 48000;
    }
    await fonte.captureFrame(new AudioFrame(dados, 48000, 2, 480));
  }

  await new Promise((r) => setTimeout(r, 1500));

  console.log(`canais recebidos.: ${canais}`);
  console.log(`amostras pareadas: ${n}`);
  console.log(`maior diferenca entre esquerda e direita: ${difMax}`);
  console.log(`\nESTEREO PRESERVADO: ${difMax > 3000 ? 'SIM' : 'NAO, chegou achatado em mono'}`);

  await bot.disconnect();
  await ouvinte.disconnect();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
