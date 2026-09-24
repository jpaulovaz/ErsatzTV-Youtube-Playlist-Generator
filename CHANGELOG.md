# Changelog

## 2.0.0

- Substituição de Remote Streams/YML por downloads locais.
- Novo worker persistente com concorrência fixa em 1.
- Estados de fila, histórico, retry, cancelamento, prioridade e supressão manual.
- Retentativas automáticas em 1, 5 e 15 minutos.
- Arquivos finais MP4/H.264/AAC validados por ffprobe.
- Remux ou transcodificação automática por ffmpeg quando necessário.
- Thumbnails JPG locais.
- Controle de espaço livre e reserva mínima configurável.
- Marcação e limpeza manual de órfãos.
- Scan/rebuild do ErsatzTV quando a fila entra em repouso.
- Migração automática de configuração v1 com backup.
- Cookies opcionais e sem ativação implícita por configuração legada.
- Limpeza manual de `.yml`, `.yaml`, `.availability.json` e `stream-yt.sh`.
- Interface reformulada para download, armazenamento, fila e histórico.
- Testes automatizados de migração, persistência, supressão, argumentos do yt-dlp e normalização real por ffmpeg.
