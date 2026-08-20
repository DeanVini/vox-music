import { AccessToken } from 'livekit-server-sdk';
import { AudioStream, Room, RoomEvent } from '@livekit/rtc-node';
import { config } from './config.js';
import { criarServidor } from './http.js';
import { Sessoes, TOPICO } from './session.js';

const SALA = `integracao-${Date.now()}`;
const PORTA = 8799;
const BASE = `http://127.0.0.1:${PORTA}`;

const passos: [string, boolean][] = [];
const marcar = (nome: string, ok: boolean): void => {
  passos.push([nome, ok]);
  console.log(`${ok ? 'OK     ' : 'FALHOU '} ${nome}`);
};

async function chamar(
  metodo: string,
  caminho: string,
  corpo?: unknown,
): Promise<{ status: number; dados: Record<string, unknown> }> {
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

  return {
    status: resposta.status,
    dados: (await resposta.json()) as Record<string, unknown>,
  };
}

async function main(): Promise<void> {
  const sessoes = new Sessoes();
  const servidor = criarServidor({ sessoes, segredo: null });
  await new Promise<void>((r) => servidor.listen(PORTA, r));
  console.log(`servidor de teste na porta ${PORTA}`);
  console.log(`sala: ${SALA}\n`);

  const ouvinte = new Room();
  let quadrosDeAudio = 0;
  let taxa = 0;
  let pico = 0;
  const anuncios: Record<string, unknown>[] = [];

  ouvinte.on(RoomEvent.TrackSubscribed, (track) => {
    void (async () => {
      for await (const q of new AudioStream(track)) {
        taxa = q.sampleRate;
        quadrosDeAudio += q.samplesPerChannel;
        for (const a of q.data) {
          const abs = Math.abs(a);
          if (abs > pico) pico = abs;
        }
      }
    })();
  });

  ouvinte.on(RoomEvent.DataReceived, (dados, _p, _k, topico) => {
    if (topico !== TOPICO) return;
    anuncios.push(JSON.parse(new TextDecoder().decode(dados)));
  });

  const token = new AccessToken(config.livekitKey, config.livekitSecret, {
    identity: 'ouvinte-integracao',
    ttl: 900,
  });
  token.addGrant({ room: SALA, roomJoin: true, canPublish: false, canSubscribe: true });
  await ouvinte.connect(config.livekitUrl, await token.toJwt(), {
    autoSubscribe: true,
    dynacast: false,
  });
  console.log('ouvinte na sala\n');

  const busca = await chamar('POST', `/salas/${SALA}/buscar`, {
    consulta: 'zara larsson lush life',
    porFonte: 3,
  });
  const resultados = busca.dados.resultados as Record<string, unknown>[];
  marcar('busca responde com opcoes', busca.status === 200 && resultados.length > 0);
  marcar(
    'busca traz as duas fontes',
    new Set(resultados.map((r) => r.origem)).size === 2,
  );

  const escolhida = resultados.find((r) => r.origem === 'youtube')!;
  console.log(`  escolhida: ${escolhida.titulo}\n`);

  const tocar = await chamar('POST', `/salas/${SALA}/tocar`, {
    pagina: escolhida.pagina,
    pedidoPor: 'dean',
  });
  marcar('pedido de tocar aceito', tocar.status === 200);

  await new Promise((r) => setTimeout(r, 9000));

  const segundos = taxa > 0 ? quadrosDeAudio / taxa : 0;
  marcar(`audio chegou (${segundos.toFixed(1)}s, pico ${pico})`, segundos > 5 && pico > 2000);

  const estado = (await chamar('GET', `/salas/${SALA}`)).dados.estado as Record<string, unknown>;
  const tocando = estado?.tocando as Record<string, unknown> | null;
  marcar('estado mostra o que esta tocando', Boolean(tocando?.titulo));
  marcar('estado registra quem pediu', tocando?.pedidoPor === 'dean');

  marcar(
    'clientes recebem o estado pela sala',
    anuncios.some((a) => a.tipo === 'estado'),
  );

  const antes = quadrosDeAudio;
  await chamar('POST', `/salas/${SALA}/volume`, { volume: 0 });
  await new Promise((r) => setTimeout(r, 2000));
  marcar('volume zero silencia sem parar o fluxo', quadrosDeAudio > antes);

  await chamar('POST', `/salas/${SALA}/volume`, { volume: 1 });

  const fila = await chamar('POST', `/salas/${SALA}/tocar`, {
    consulta: 'daft punk one more time',
    pedidoPor: 'amigo',
  });
  const estadoDaFila = fila.dados.estado as Record<string, unknown>;
  marcar('segunda faixa entra na fila', (estadoDaFila.fila as unknown[]).length === 1);

  const pulou = await chamar('POST', `/salas/${SALA}/pular`);
  marcar('pular responde', pulou.dados.pulou === true);

  await new Promise((r) => setTimeout(r, 6000));

  const depois = (await chamar('GET', `/salas/${SALA}`)).dados.estado as Record<string, unknown>;
  const agora = depois?.tocando as Record<string, unknown> | null;
  marcar('pular avanca para a proxima da fila', agora?.pedidoPor === 'amigo');

  const saiu = await chamar('DELETE', `/salas/${SALA}`);
  marcar('bot sai da sala quando pedido', saiu.dados.saiu === true);

  servidor.close();
  await ouvinte.disconnect();

  const falhas = passos.filter(([, ok]) => !ok).length;
  console.log(`\n${passos.length - falhas} de ${passos.length} passaram`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((erro) => {
  console.error('erro na prova:', erro);
  process.exit(1);
});
