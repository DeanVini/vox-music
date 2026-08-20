import { config } from './config.js';
import { criarServidor } from './http.js';
import { Sessoes } from './session.js';

const porta = Number(process.env.PORT ?? 8790);
const segredo = process.env.CONTROL_SECRET ?? null;

const sessoes = new Sessoes();
const servidor = criarServidor({ sessoes, segredo });

servidor.listen(porta, () => {
  console.log(`vox-music ouvindo na porta ${porta}`);
  console.log(`livekit: ${config.livekitUrl}`);
  if (!segredo) console.log('AVISO: sem CONTROL_SECRET, a API esta aberta');
});

async function encerrar(sinal: string): Promise<void> {
  console.log(`\n${sinal}: saindo das salas`);
  servidor.close();
  await sessoes.encerrarTudo();
  process.exit(0);
}

process.on('SIGINT', () => void encerrar('SIGINT'));
process.on('SIGTERM', () => void encerrar('SIGTERM'));
