# Changelog

## 2.3.1

- Suporte à autenticação da API do ErsatzTV por `X-Etv-Api-Key`.
- Novo campo protegido `Configurações → ErsatzTV → API Key do ErsatzTV`.
- A chave é enviada em scan de biblioteca, limpeza de lixo e rebuild de playout.
- Respostas HTTP 401/403 da API agora indicam chave ausente ou inválida.
- Configurações existentes continuam compatíveis; nenhuma chave é inventada ou migrada automaticamente.
- Novos testes automatizados para envio do header e falhas de autorização.

## 2.3.0

- Interface móvel dedicada sem alterar a experiência consolidada do desktop.
- Navegação inferior fixa com cinco áreas e suporte a safe areas de iOS/Android.
- Cabeçalho mobile compacto com estado operacional e painel deslizante de ações rápidas.
- Controles móveis para buscar novidades, pausar/retomar fila, atualizar dados e encerrar sessão.
- Tabela de downloads transformada em cartões responsivos no celular.
- Filtros, formulários, bibliotecas, sanfonas, logs, diálogos e notificações revisados para toque.
- Campos com tamanho adequado para evitar zoom automático em navegadores móveis.
- Melhorias de acessibilidade, foco, fechamento por Escape e bloqueio de rolagem no painel móvel.
- Nenhuma alteração no formato da configuração, autenticação, fila ou arquivos de mídia.

## 2.2.0

- Interface administrativa redesenhada com linguagem visual mais sóbria e profissional.
- Navegação lateral por Visão geral, Downloads, Bibliotecas, Configurações e Logs.
- Novo símbolo vetorial da aplicação, substituindo o ícone textual `YT`.
- Configurações reorganizadas integralmente em sanfonas fechadas por padrão.
- Bibliotecas convertidas em sanfonas individuais com resumo, estado e métricas.
- Fila e histórico preservados em sanfona, com visual mais compacto.
- Revisão de espaçamentos, tipografia, métricas, tabelas, ações e comportamento responsivo.
- Tela de login mantida e integrada ao novo símbolo.
- Nenhuma alteração no formato da configuração, fila, autenticação ou arquivos de mídia.

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
