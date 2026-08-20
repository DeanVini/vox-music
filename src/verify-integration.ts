import { AccessToken } from 'livekit-server-sdk';
import { AudioStream, Room, RoomEvent } from '@livekit/rtc-node';
import { config } from './config.js';
import { createHttpServer } from './http.js';
import { Sessions, TOPIC } from './session.js';

const ROOM = `verify-${Date.now()}`;
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;

const checks: [string, boolean][] = [];
const check = (name: string, ok: boolean): void => {
  checks.push([name, ok]);
  console.log(`${ok ? 'OK     ' : 'FAILED '} ${name}`);
};

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return {
    status: response.status,
    data: (await response.json()) as Record<string, unknown>,
  };
}

async function main(): Promise<void> {
  const sessions = new Sessions();
  const server = createHttpServer({ sessions, secret: null });
  await new Promise<void>((r) => server.listen(PORT, r));
  console.log(`room: ${ROOM}\n`);

  const listener = new Room();
  let audioFrames = 0;
  let sampleRate = 0;
  let peak = 0;
  const announcements: Record<string, unknown>[] = [];

  listener.on(RoomEvent.TrackSubscribed, (track) => {
    void (async () => {
      for await (const frame of new AudioStream(track)) {
        sampleRate = frame.sampleRate;
        audioFrames += frame.samplesPerChannel;
        for (const sample of frame.data) {
          const abs = Math.abs(sample);
          if (abs > peak) peak = abs;
        }
      }
    })();
  });

  listener.on(RoomEvent.DataReceived, (data, _p, _k, topic) => {
    if (topic !== TOPIC) return;
    announcements.push(JSON.parse(new TextDecoder().decode(data)));
  });

  const token = new AccessToken(config.livekitKey, config.livekitSecret, {
    identity: 'verify-listener',
    ttl: 900,
  });
  token.addGrant({ room: ROOM, roomJoin: true, canPublish: false, canSubscribe: true });
  await listener.connect(config.livekitUrl, await token.toJwt(), {
    autoSubscribe: true,
    dynacast: false,
  });

  const search = await call('POST', `/rooms/${ROOM}/search`, {
    query: 'zara larsson lush life',
    perSource: 3,
  });
  const results = search.data.results as Record<string, unknown>[];
  check('search returns options', search.status === 200 && results.length > 0);
  check('search covers both sources', new Set(results.map((r) => r.source)).size === 2);

  const picked = results.find((r) => r.source === 'youtube')!;
  console.log(`  picked: ${picked.title}\n`);

  const play = await call('POST', `/rooms/${ROOM}/play`, {
    page: picked.page,
    requestedBy: 'dean',
  });
  check('play accepted', play.status === 200);

  await new Promise((r) => setTimeout(r, 9000));

  const seconds = sampleRate > 0 ? audioFrames / sampleRate : 0;
  check(`audio arrives (${seconds.toFixed(1)}s, peak ${peak})`, seconds > 5 && peak > 2000);

  const state = (await call('GET', `/rooms/${ROOM}`)).data.state as Record<string, unknown>;
  const playing = state?.playing as Record<string, unknown> | null;
  check('state reports what is playing', Boolean(playing?.title));
  check('state records who asked', playing?.requestedBy === 'dean');
  check('clients receive state in the room', announcements.some((a) => a.type === 'state'));

  const before = audioFrames;
  await call('POST', `/rooms/${ROOM}/volume`, { volume: 0 });
  await new Promise((r) => setTimeout(r, 2000));
  check('volume zero mutes without stopping the stream', audioFrames > before);

  await call('POST', `/rooms/${ROOM}/volume`, { volume: 1 });

  const queued = await call('POST', `/rooms/${ROOM}/play`, {
    query: 'daft punk one more time',
    requestedBy: 'friend',
  });
  const queuedState = queued.data.state as Record<string, unknown>;
  check('second track joins the queue', (queuedState.queue as unknown[]).length === 1);

  const skipped = await call('POST', `/rooms/${ROOM}/skip`);
  check('skip responds', skipped.data.skipped === true);

  await new Promise((r) => setTimeout(r, 6000));

  const after = (await call('GET', `/rooms/${ROOM}`)).data.state as Record<string, unknown>;
  const now = after?.playing as Record<string, unknown> | null;
  check('skip advances to the queued track', now?.requestedBy === 'friend');

  const left = await call('DELETE', `/rooms/${ROOM}`);
  check('bot leaves the room on request', left.data.left === true);

  server.close();
  await listener.disconnect();

  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`\n${checks.length - failed} of ${checks.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('verification failed:', error);
  process.exit(1);
});
