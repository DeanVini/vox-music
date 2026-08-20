import { AccessToken } from 'livekit-server-sdk';
import { Room } from '@livekit/rtc-node';
import { config } from './config.js';
import { criarServidor } from './http.js';
import { Sessoes } from './session.js';

const SALA = `ocioso-${Date.now()}`;
const PORTA = 8797;
const BASE = `http://127.0.0.1:${PORTA}`;

const passos: [string, boolean][] = [];
const marcar = (nome: string, ok: boolean): void => {
  passos.push([nome, ok]);
  console.log(`${ok ? 'OK     ' : 'FALHOU '} ${nome}`);
};

async function chamar(metodo: string, caminho: string, corpo?: unknown) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { status: r.status, dados: (await r.json()) as Record<string, unknown> };
}

async function ouvinteEntra(identidade: string): Promise<Room> {
  const t = new AccessToken(config.livekitKey, config.livekitSecret, {
    identity: identidade,
    ttl: 600,
  });
  t.addGrant({ room: SALA, roomJoin: true, canPublish: false, canSubscribe: true });

  const room = new Room();
  await room.connect(config.livekitUrl, await t.toJwt(), {
    autoSubscribe: true,
    dynacast: false,
  });
  return room;
}

async function main(): Promise<void> {
  console.log(`ociosidade configurada: ${config.ociosidadeMs}ms`);
  console.log(`limite da fila: ${config.limiteDaFila}`);
  console.log(`sala: ${SALA}\n`);

  const sessoes = new Sessoes();
  const servidor = criarServidor({ sessoes, segredo: null });
  await new Promise<void>((r) => servidor.listen(PORTA, r));

  const ouvinte = await ouvinteEntra('ouvinte-ocioso');

  await chamar('POST', `/salas/${SALA}/tocar`, {
    consulta: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    pedidoPor: 'dean',
  });
  marcar('bot entrou e comecou a tocar', sessoes.atual(SALA) !== null);

  await new Promise((r) => setTimeout(r, 3000));
  marcar(
    'nao sai enquanto esta tocando',
    sessoes.atual(SALA) !== null,
  );

  await chamar('POST', `/salas/${SALA}/pular`);
  console.log(`  fila vazia, esperando a ociosidade de ${config.ociosidadeMs}ms\n`);

  await new Promise((r) => setTimeout(r, config.ociosidadeMs + 4000));
  marcar('saiu sozinho depois da ociosidade', sessoes.atual(SALA) === null);

  await chamar('POST', `/salas/${SALA}/tocar`, {
    consulta: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    pedidoPor: 'dean',
  });
  marcar('volta a entrar quando pedem de novo', sessoes.atual(SALA) !== null);

  console.log('  ouvinte saindo da sala...');
  await ouvinte.disconnect();
  await new Promise((r) => setTimeout(r, 4000));
  marcar('sai quando a sala fica vazia, sem esperar', sessoes.atual(SALA) === null);

  servidor.close();
  await sessoes.encerrarTudo();

  const falhas = passos.filter(([, ok]) => !ok).length;
  console.log(`\n${passos.length - falhas} de ${passos.length} passaram`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((erro) => {
  console.error('erro:', erro);
  process.exit(1);
});
