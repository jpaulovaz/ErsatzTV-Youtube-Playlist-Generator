# Changelog

## 2.1.0

- Login administrativo local obrigatório, sem dependências externas.
- Senha derivada por scrypt e armazenada somente em `config/auth.json` com permissão `600`.
- Sessões assinadas em memória, cookie HttpOnly/SameSite, CSRF, validação de origem e bloqueio temporário de força bruta.
- Suporte seguro a proxy reverso confiável e cookie `Secure` automático sob HTTPS.
- Nova tela de login responsiva com estado de configuração inicial.
- Nova ação para limpar toda a fila ou apenas uma biblioteca.
- Limpeza preserva arquivos concluídos e suprime itens removidos para impedir redescoberta automática.
- Resumo ampliado da fila, incluindo espaço, tamanho local, retries, velocidade e último item concluído.
- Lista de downloads movida para sanfona fechada por padrão.
- Paginação e filtros por status e biblioteca para filas extensas.
- Remoção da função e das rotas de limpeza de YML legado.
- Cabeçalhos de segurança para a interface web.
- Novos testes automatizados de autenticação, CSRF, lockout, limpeza e paginação da fila.

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
- Interface reformulada para download, armazenamento, fila e histórico.
- Testes automatizados de migração, persistência, supressão, argumentos do yt-dlp e normalização real por ffmpeg.
