import { readFileSync } from 'node:fs';
import { AccessToken } from 'livekit-server-sdk';
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => {
      const corte = line.indexOf('=');
      return [line.slice(0, corte).trim(), line.slice(corte + 1).trim()];
    }),
);

const URL_LK = env.LIVEKIT_URL!;
const CHAVE = env.LIVEKIT_API_KEY!;
const SEGREDO = env.LIVEKIT_API_SECRET!;

const SALA = `prova-musica-${Date.now()}`;
const TAXA = 48000;
const CANAIS = 2;
const AMOSTRAS_POR_QUADRO = 480;

async function token(identidade: string, publicar: boolean): Promise<string> {
  const t = new AccessToken(CHAVE, SEGREDO, { identity: identidade, ttl: 600 });
  t.addGrant({
    room: SALA,
    roomJoin: true,
    canPublish: publicar,
    canSubscribe: true,
  });
  return t.toJwt();
}

function quadroDeTom(fase: number, hz: number): [AudioFrame, number] {
  const dados = new Int16Array(AMOSTRAS_POR_QUADRO * CANAIS);
  const passo = (2 * Math.PI * hz) / TAXA;

  for (let i = 0; i < AMOSTRAS_POR_QUADRO; i++) {
    const v = Math.round(Math.sin(fase) * 12000);
    dados[i * CANAIS] = v;
    dados[i * CANAIS + 1] = v;
    fase += passo;
  }

  return [new AudioFrame(dados, TAXA, CANAIS, AMOSTRAS_POR_QUADRO), fase];
}

async function main(): Promise<void> {
  console.log(`sala de teste: ${SALA}`);
  console.log(`servidor: ${URL_LK}\n`);

  const ouvinte = new Room();
  let quadrosRecebidos = 0;
  let picoRecebido = 0;
  let somaRecebida = 0;
  let amostrasRecebidas = 0;

  ouvinte.on(RoomEvent.TrackSubscribed, (track) => {
    console.log('[ouvinte] inscrito na faixa do bot');
    const stream = new AudioStream(track);

    void (async () => {
      for await (const quadro of stream) {
        quadrosRecebidos++;
        const amostras = new Int16Array(
          quadro.data.buffer,
          quadro.data.byteOffset,
          quadro.data.length,
        );
        for (const a of amostras) {
          const abs = Math.abs(a);
          if (abs > picoRecebido) picoRecebido = abs;
          somaRecebida += abs;
          amostrasRecebidas++;
        }
      }
    })();
  });

  await ouvinte.connect(URL_LK, await token('ouvinte-de-prova', false), {
    autoSubscribe: true,
    dynacast: false,
  });
  console.log('[ouvinte] conectado');

  const bot = new Room();
  await bot.connect(URL_LK, await token('vox-musica', true), {
    autoSubscribe: false,
    dynacast: false,
  });
  console.log('[bot] conectado');

  const fonte = new AudioSource(TAXA, CANAIS);
  const faixa = LocalAudioTrack.createAudioTrack('musica', fonte);
  const opcoes = new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE });

  await bot.localParticipant!.publishTrack(faixa, opcoes);
  console.log('[bot] faixa publicada, enviando tom de 440 Hz por 3 segundos\n');

  let fase = 0;
  const quadros = Math.floor((3 * TAXA) / AMOSTRAS_POR_QUADRO);
  for (let i = 0; i < quadros; i++) {
    const [quadro, novaFase] = quadroDeTom(fase, 440);
    fase = novaFase;
    await fonte.captureFrame(quadro);
  }

  await new Promise((r) => setTimeout(r, 1500));

  const media = amostrasRecebidas > 0 ? somaRecebida / amostrasRecebidas : 0;

  console.log('=== resultado no lado de quem ouve ===');
  console.log(`quadros recebidos.: ${quadrosRecebidos}`);
  console.log(`amostras..........: ${amostrasRecebidas}`);
  console.log(`pico..............: ${picoRecebido} (de 32767)`);
  console.log(`media absoluta....: ${media.toFixed(1)}`);
  console.log(
    `\nAUDIO CHEGOU DE VERDADE: ${quadrosRecebidos > 0 && picoRecebido > 1000 ? 'SIM' : 'NAO'}`,
  );

  await bot.disconnect();
  await ouvinte.disconnect();
  process.exit(0);
}

main().catch((erro) => {
  console.error('falhou:', erro);
  process.exit(1);
});
