# Atualização para 3.5.2

A versão 3.5.2 é um ajuste incremental sobre a v3.5.1. Ela melhora a disposição da ação **Duplicar item** em Scripted Schedules e remove a manutenção manual obsoleta **Atualizar thumbnails** sem alterar schemas, dados persistentes ou o Universal.

## O que muda

- **Duplicar item** e **Remover** ficam agrupados à direita na mesma faixa de ações de cada item de Scripted Schedules;
- a lógica de duplicação da v3.5.1 permanece igual: cópia profunda, ID único quando necessário, Nome opcional com **(cópia)** e inserção logo após o original;
- o botão **Atualizar thumbnails** deixa de aparecer em Bibliotecas e Playlists de Canais;
- a rota/ação correspondente e o método manual `refreshThumbnails()` são removidos;
- o download normal continua criando thumbnails/artwork normalmente;
- **Atualizar thumbnails existentes** continua em Configurações, pois ainda define se o fluxo normal de finalização pode substituir um JPG já existente.

## Versões e compatibilidade

- aplicação: **v3.5.2**;
- versão-base do update: **v3.5.1**;
- Universal: **v1.3.1**;
- `configVersion`: **9**;
- schema de Scripted Schedules: **1**;
- estado persistente de downloads: **5**.

Não existe migração de configuração, estado, mídia ou projetos de Scripted Schedule nesta atualização.

## Antes de atualizar

Pare o aplicativo. Não há migração de dados nesta versão, mas manter uma cópia recente de `config/` e `data/` continua sendo uma boa prática operacional.

## Aplicar o update

Extraia `ErsatzTV-YouTube-Downloader-v3.5.2-update.zip` sobre uma instalação **v3.5.1**:

```bash
cd /caminho/da/aplicacao
pm2 stop ersatztv-youtube-downloader
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.5.2-update.zip -d .
npm run verify
pm2 restart ersatztv-youtube-downloader --update-env
pm2 save
```

O pacote `update` não contém `config/config.json`, `config/auth.json` nem o conteúdo operacional de `data/`.

Depois do primeiro acesso, faça `Ctrl+F5` para garantir que o navegador carregue os arquivos JavaScript/CSS da v3.5.2.

## Verificação rápida

1. Abra **Scripted Schedules -> Programação** e expanda um item.
2. Confirme que **Duplicar item** aparece imediatamente ao lado de **Remover**, ambos alinhados à direita.
3. Duplique um item e confirme que o comportamento da v3.5.1 foi preservado.
4. Abra uma Biblioteca e confirme que **Atualizar thumbnails** não aparece mais em **Conteúdo**.
5. Se usar Playlists de Canais, confirme a mesma remoção nessa área.
6. Em **Configurações**, confirme que **Atualizar thumbnails existentes** continua disponível.
7. Rode `npm run verify` e confirme que a suíte termina sem falhas.

## Rollback

Como a v3.5.2 não altera schemas nem dados persistentes, o rollback para v3.5.1 consiste em restaurar os arquivos de código da versão anterior. Configurações, estado e projetos permanecem compatíveis.
