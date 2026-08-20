#!/bin/sh
set -e

# O YouTube muda com frequencia para quebrar extratores, e o yt-dlp corrige
# em dias. Atualizar na subida evita ter que reconstruir a imagem so por isso.
if [ "$ATUALIZAR_YTDLP" = "1" ]; then
  echo "atualizando yt-dlp..."
  timeout 60 yt-dlp -U 2>&1 | tail -2 || echo "atualizacao falhou, seguindo com a versao da imagem"
fi

yt-dlp --version | sed 's/^/yt-dlp /'
ffmpeg -version 2>/dev/null | head -1

exec "$@"
