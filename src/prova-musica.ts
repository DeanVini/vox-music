import { AccessToken } from 'livekit-server-sdk';
import {
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';
import { config } from './config.js';
import { Reprodutor } from './player.js';
import { duracaoLegivel, resolver } from './source.js';

const SALA = `prova-musica-${Date.now()}`;
const SEGUNDOS_DE_TESTE = 8;

async function token(identidade: string, publicar: boolean): Promise<string> {
  const t = new AccessToken(config.livekitKey, config.livekitSecret, {
    identity: identidade,
    ttl: 900,
  });
  t.addGrant({ room: SALA, roomJoin: true, canPublish: publicar, canSubscribe: true });
  return t.toJwt();
}

async function main(): Promise<void> {
  const consulta = process.argv[2] ?? 'daft punk one more time';

  console.log(`buscando: ${consulta}`);
  const faixa = await resolver(consulta);
  console.log(`  ${faixa.titulo}`);
  console.log(`  ${faixa.autor ?? 'sem autor'} · ${duracaoLegivel(faixa.duracaoSegundos)} · ${faixa.origem}\n`);

  const ouvinte = new Room();
  let quadros = 0;
  let pico = 0;
  let soma = 0;
  let amostras = 0;
  let primeiroQuadroEm = 0;
  let ultimoQuadroEm = 0;
  let canaisRecebidos = 0;
  let taxaRecebida = 0;
  let quadrosDeAudio = 0;

  ouvinte.on(RoomEvent.TrackSubscribed, (track) => {
    console.log('[ouvinte] recebendo a faixa');
    void (async () => {
      for await (const quadro of new AudioStream(track)) {
        quadros++;
        if (primeiroQuadroEm === 0) primeiroQuadroEm = Date.now();
        ultimoQuadroEm = Date.now();

        canaisRecebidos = quadro.channels;
        taxaRecebida = quadro.sampleRate;
        quadrosDeAudio += quadro.samplesPerChannel;
        const dados = new Int16Array(
          quadro.data.buffer,
          quadro.data.byteOffset,
          quadro.data.length,
        );
        for (const a of dados) {
          const abs = Math.abs(a);
          if (abs > pico) pico = abs;
          soma += abs;
          amostras++;
        }
      }
    })();
  });

  await ouvinte.connect(config.livekitUrl, await token('ouvinte-de-prova', false), {
    autoSubscribe: true,
    dynacast: false,
  });

  const bot = new Room();
  await bot.connect(config.livekitUrl, await token(config.identidade, true), {
    autoSubscribe: false,
    dynacast: false,
  });

  const fonte = new AudioSource(config.taxaAmostragem, config.canais, config.filaDeAudioMs);
  await bot.localParticipant!.publishTrack(
    LocalAudioTrack.createAudioTrack('musica', fonte),
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
  );

  const reprodutor = new Reprodutor(fonte);
  const inicio = Date.now();

  console.log(`[bot] tocando por ${SEGUNDOS_DE_TESTE}s\n`);
  const tocando = reprodutor.tocar(faixa.pagina);

  setTimeout(() => reprodutor.parar(), SEGUNDOS_DE_TESTE * 1000);
  const resultado = await tocando;

  await new Promise((r) => setTimeout(r, 1200));

  const decorrido = (Date.now() - inicio) / 1000;
  const segundosDeAudio = taxaRecebida > 0 ? quadrosDeAudio / taxaRecebida : 0;
  const media = amostras > 0 ? soma / amostras : 0;

  console.log('=== medido em quem ouve ===');
  console.log(`motivo do fim....: ${resultado.motivo}${resultado.erro ? ` (${resultado.erro})` : ''}`);
  console.log(`quadros..........: ${quadros}`);
  console.log(`audio recebido...: ${segundosDeAudio.toFixed(1)}s em ${decorrido.toFixed(1)}s de relogio`);
  console.log(`pico.............: ${pico} (de 32767)`);
  console.log(`media absoluta...: ${media.toFixed(0)}`);

  const partida = (primeiroQuadroEm - inicio) / 1000;
  const janela = (ultimoQuadroEm - primeiroQuadroEm) / 1000;
  const ritmo = janela > 0 ? segundosDeAudio / janela : 0;

  const temSom = pico > 3000 && media > 200;
  const ritmoOk = ritmo > 0.9 && ritmo < 1.1;

  console.log(`formato recebido.: ${canaisRecebidos} canal(is) a ${taxaRecebida} Hz`);
  console.log(`atraso de partida: ${partida.toFixed(1)}s ate o primeiro quadro`);
  console.log(`janela de fluxo..: ${janela.toFixed(1)}s`);
  console.log(`ritmo............: ${ritmo.toFixed(3)}x (1.000 = tempo real)`);

  console.log(`\nMUSICA CHEGOU.......: ${temSom ? 'SIM' : 'NAO'}`);
  console.log(`RITMO EM TEMPO REAL.: ${ritmoOk ? 'SIM' : 'NAO'}`);

  await bot.disconnect();
  await ouvinte.disconnect();
  process.exit(temSom && ritmoOk ? 0 : 1);
}

main().catch((erro) => {
  console.error('falhou:', erro);
  process.exit(1);
});
