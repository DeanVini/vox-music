import { config } from './config.js';
import { criarServidor } from './http.js';
import { Sessoes } from './session.js';

const SALA = `limite-${Date.now()}`;
const PORTA = 8796;

const sessoes = new Sessoes();
const servidor = criarServidor({ sessoes, segredo: null });
await new Promise<void>((r) => servidor.listen(PORTA, r));

const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const chamar = async () => {
  const r = await fetch(`http://127.0.0.1:${PORTA}/salas/${SALA}/tocar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pagina: url, pedidoPor: 'dean' }),
  });
  return { status: r.status, dados: (await r.json()) as Record<string, unknown> };
};

console.log(`limite configurado: ${config.limiteDaFila}\n`);

const respostas = [];
for (let i = 0; i < config.limiteDaFila + 1; i++) respostas.push(await chamar());

respostas.forEach((r, i) => console.log(`  pedido ${i + 1}: http ${r.status}${r.status !== 200 ? ' -> ' + r.dados.erro : ''}`));

const aceitos = respostas.filter((r) => r.status === 200).length;
const recusado = respostas.at(-1);

console.log(`\naceitos: ${aceitos} de ${respostas.length}`);
console.log(`ACEITOU ATE O LIMITE...: ${aceitos === config.limiteDaFila ? 'SIM' : 'NAO'}`);
console.log(`RECUSOU O EXCEDENTE....: ${recusado?.status === 409 ? 'SIM' : 'NAO'}`);
console.log(`MENSAGEM EXPLICA O QUE FAZER: ${String(recusado?.dados.erro ?? '')}`);

servidor.close();
await sessoes.encerrarTudo();
process.exit(aceitos === config.limiteDaFila && recusado?.status === 409 ? 0 : 1);
