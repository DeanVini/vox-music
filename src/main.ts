import { config } from './config.js';
import { createHttpServer } from './http.js';
import { Sessions } from './session.js';

const port = Number(process.env.PORT ?? 8790);
const secret = process.env.CONTROL_SECRET ?? null;

const sessions = new Sessions();
const server = createHttpServer({ sessions, secret });

server.listen(port, () => {
  console.log(`vox-music ouvindo na porta ${port}`);
  console.log(`livekit: ${config.livekitUrl}`);
  if (!secret) console.log('AVISO: sem CONTROL_SECRET, a API esta aberta');
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal}: saindo das salas`);
  server.close();
  await sessions.closeAll();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
