# Vox Música

Bot de música do Vox. Entra num canal de voz como participante do LiveKit e
toca do YouTube e do SoundCloud.

## Como funciona

O bot só faz conexões de saída. Ele entra na sala do LiveKit como cliente e
recebe comandos por HTTP, então não precisa de porta exposta além da API de
controle.

```
consulta -> yt-dlp -> ffmpeg -> PCM 48kHz -> AudioSource -> sala do LiveKit
```

O estado da fila é anunciado para quem está na sala pelo canal de dados do
próprio LiveKit, no tópico `vox:musica`, sem passar pela API do Vox.

## Variáveis

| variável | para quê |
|---|---|
| `LIVEKIT_URL` | endereço do servidor, com `wss://` |
| `LIVEKIT_API_KEY` | chave da API |
| `LIVEKIT_API_SECRET` | segredo da API |
| `CONTROL_SECRET` | protege a API de controle. Sem ela a API fica aberta |
| `PORT` | porta da API, padrão 8790 |
| `ATUALIZAR_YTDLP` | `1` atualiza o yt-dlp ao subir o container |

## API

Tudo em `/salas/{sala}`, com `Authorization: Bearer <CONTROL_SECRET>`.

| método | rota | o que faz |
|---|---|---|
| POST | `/buscar` | opções do YouTube e SoundCloud, intercaladas |
| POST | `/tocar` | resolve e põe na fila |
| POST | `/pular` | passa para a próxima |
| POST | `/pausar` | pausa ou retoma |
| POST | `/volume` | 0 a 2 |
| POST | `/limpar` | esvazia a fila |
| DELETE | `/fila/{indice}` | tira um item |
| GET | (raiz) | estado atual |
| DELETE | (raiz) | tira o bot da sala |

## Provas

Os arquivos `src/prova-*.ts` não são exemplos: eles medem o áudio que
realmente chega, com um segundo participante dentro da sala.

```bash
npx tsx src/prova.ts             # o áudio atravessa o servidor
npx tsx src/prova-musica.ts      # toca de verdade, e no ritmo certo
npx tsx src/prova-busca.ts       # busca nas duas fontes
npx tsx src/prova-integracao.ts  # a API inteira, ponta a ponta
npx tsx src/prova-estereo.ts     # mostra a limitação de mono
```

## Limitação conhecida

O som chega **em mono**. Medido mandando 440 Hz só no canal esquerdo: a
diferença entre os canais chega zero. O SDK do LiveKit para Node não negocia
Opus estéreo, e a estrutura de opções só expõe taxa de bits. Mono a 128 kbps
é bem audível, mas não é estéreo.

## Manutenção

O YouTube muda de propósito para quebrar extratores. O yt-dlp corrige em dias,
e por isso o container o atualiza ao subir. Se um dia parar de tocar do
YouTube, reinicie o container antes de investigar qualquer outra coisa.
