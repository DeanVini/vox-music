import { AccessToken } from 'livekit-server-sdk';
import { AudioStream, Room, RoomEvent } from '@livekit/rtc-node';
import { config } from './config.js';

const sala = process.argv[2] ?? 'teste';
const segundos = Number(process.argv[3] ?? 10);

const t = new AccessToken(config.livekitKey, config.livekitSecret, {
  identity: `medidor-${Date.now()}`,
  ttl: 600,
});
t.addGrant({ room: sala, roomJoin: true, canPublish: false, canSubscribe: true });

const room = new Room();
let quadros = 0;
let taxa = 0;
let pico = 0;
let soma = 0;
let n = 0;
let silencioSeguido = 0;
let maiorSilencio = 0;

room.on(RoomEvent.TrackSubscribed, (track, _pub, participante) => {
  console.log(`recebendo faixa de: ${participante.identity}`);
  void (async () => {
    for await (const q of new AudioStream(track)) {
      taxa = q.sampleRate;
      quadros += q.samplesPerChannel;
      let quadroMudo = true;
      for (const a of q.data) {
        const abs = Math.abs(a);
        if (abs > pico) pico = abs;
        if (abs > 50) quadroMudo = false;
        soma += abs;
        n++;
      }
      silencioSeguido = quadroMudo ? silencioSeguido + 1 : 0;
      if (silencioSeguido > maiorSilencio) maiorSilencio = silencioSeguido;
    }
  })();
});

await room.connect(config.livekitUrl, await t.toJwt(), {
  autoSubscribe: true,
  dynacast: false,
});

console.log(`na sala "${sala}", medindo por ${segundos}s`);
console.log(`participantes: ${[...room.remoteParticipants.values()].map((p) => p.identity).join(', ') || 'nenhum'}`);

await new Promise((r) => setTimeout(r, segundos * 1000));

const dur = taxa > 0 ? quadros / taxa : 0;
const media = n > 0 ? soma / n : 0;

console.log(`\naudio recebido...: ${dur.toFixed(1)}s`);
console.log(`pico.............: ${pico} (de 32767)`);
console.log(`media absoluta...: ${media.toFixed(0)}`);
console.log(`maior silencio...: ${(maiorSilencio * 0.01).toFixed(1)}s seguidos`);
console.log(`\nMUSICA TOCANDO DE VERDADE: ${dur > segundos * 0.7 && pico > 3000 && media > 150 ? 'SIM' : 'NAO'}`);

await room.disconnect();
process.exit(0);
