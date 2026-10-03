# Atualização para 3.5.3

A versão 3.5.3 é uma faxina estrutural sobre a v3.5.2. O objetivo é reduzir dívida técnica e remover compatibilidades que já cumpriram sua função, sem retirar recursos atuais do aplicativo.

## Pré-requisito obrigatório

Antes de atualizar, execute a v3.5.2 uma última vez e confirme:

- `config/config.json` usa `"configVersion": 9`;
- todos os projetos de **Scripted Schedules** que ainda serão utilizados estão no **Universal v1.3.1**;
- a aplicação inicia normalmente e a fila não possui operação crítica interrompida.

A v3.5.3 **não migra** configurações anteriores nem motores Universal antigos. Se algum item ainda estiver pendente, conclua a migração na v3.5.2 antes de aplicar este update.

## O que muda

- configuração passa a aceitar somente o schema atual (`configVersion` 9), sem fallbacks de versões antigas;
- Scripted Schedules passa a trabalhar somente com Universal v1.3.1;
- compatibilidade de `movieMetadata`/`showMetadata` antigos é retirada dos caminhos atuais; o perfil `mediaProfile` continua sendo a fonte de verdade;
- a antiga opção `updateExistingThumbnails` deixa de existir. O comportamento atual preserva artwork já existente e continua criando artwork quando ele ainda não existe;
- o enriquecimento de data continua existindo, agora dentro da camada atual de descoberta (`releaseMetadataService`), sem depender do antigo `releaseDateService`;
- Clipes musicais deixam de executar resequenciamento global. Novos episódios recebem numeração incremental estável; numa colisão durante restauração, somente o item restaurado recebe o próximo episódio livre;
- execução de processos externos, argumentos comuns de yt-dlp e movimentação entre filesystems passam a reutilizar utilitários compartilhados;
- a montagem/parsing específico de downloads do yt-dlp sai do `downloadManager` para um módulo dedicado;
- `npm run check` e `npm test` descobrem automaticamente os arquivos atuais; testes usam log temporário e não deixam resíduos na árvore;
- `npm run verify` é não destrutivo e também verifica a consistência do versionamento da release;
- o exemplo systemd fica genérico, sem usuário/versão específicos de uma instalação.

## Versões

- aplicação: **v3.5.3**;
- versão-base do update: **v3.5.2**;
- Universal suportado: **v1.3.1**;
- `configVersion`: **9**;
- schema de Scripted Schedules: **1**;
- estado persistente de downloads: **5**.

Não há mudança de schema do estado nem do armazenamento dos projetos. A exigência é que os dados já tenham sido migrados antes, conforme o pré-requisito acima.

## Antes de atualizar

1. Pare o aplicativo.
2. Faça backup de `config/` e `data/`.
3. Confirme os pré-requisitos acima.
4. Leia `MANUAL_CLEANUP_3.5.3.txt`; os arquivos listados ali não são mais usados pelo código atual e podem ser removidos manualmente depois que a v3.5.3 estiver validada.

## Aplicar o update

Extraia `ErsatzTV-YouTube-Downloader-v3.5.3-update.zip` sobre uma instalação **v3.5.2**:

```bash
cd /caminho/da/aplicacao
pm2 stop ersatztv-youtube-downloader
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.5.3-update.zip -d .
npm run verify
pm2 restart ersatztv-youtube-downloader --update-env
pm2 save
```

O pacote `update` não contém `config/config.json`, `config/auth.json` nem o conteúdo operacional de `data/`.

Depois do primeiro acesso, faça `Ctrl+F5` para garantir que o navegador carregue os arquivos JavaScript/CSS da v3.5.3.

## Verificação rápida

1. Abra **Bibliotecas**, faça uma descoberta e confirme fila/download normal.
2. Se usar **Canais**, execute uma descoberta de uma Playlist selecionada.
3. Abra **Ver conteúdo** e confirme Conteúdo/Órfãos/Quarentena/Ignorados conforme aplicável.
4. Em uma biblioteca de Clipes musicais, confirme que novos episódios recebem o próximo `SxxExx` sem renumerar os anteriores.
5. Abra um projeto de **Scripted Schedules** e confirme que o motor exibido é Universal v1.3.1.
6. Rode `npm run verify` e confirme que sintaxe, testes e consistência da release terminam sem falhas.
7. Somente depois dessa validação, faça a limpeza manual dos arquivos de `MANUAL_CLEANUP_3.5.3.txt`.

## Rollback

Configuração v9, estado v5 e projetos Universal v1.3.1 continuam legíveis pela v3.5.2. Para rollback, restaure os arquivos da v3.5.2 mantendo `config/` e `data/`. Se você já tiver removido manualmente os arquivos obsoletos listados para a v3.5.3, use um pacote completo v3.5.2 para restaurar também esses arquivos antes do rollback.
