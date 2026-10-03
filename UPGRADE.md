# Atualização para 3.5.1

A versão 3.5.1 é um upgrade focado no editor de **Scripted Schedules**. Ela adiciona a ação **Duplicar item** aos itens principais dos módulos sem alterar o formato dos projetos, o Universal ou os dados do downloader.

## O que muda

- cada item de módulo passa a ter **Duplicar item** na mesma área de ações em que já existe **Remover**;
- a cópia é inserida imediatamente depois do item original e abre automaticamente para edição;
- todos os campos e estruturas internas são clonados profundamente, incluindo passos de Sequence, opções de Choice Event, posições de Clock Template e itens de Window Rotation;
- itens com ID recebem automaticamente um ID único em todo o projeto (`_copy`, `_copy_2`, `_copy_3`, ...);
- quando existe **Nome opcional**, a cópia recebe o sufixo **(cópia)**;
- horário, Source, Presentation, prioridade, recorrência e demais configurações não são alterados automaticamente.

## Versões e compatibilidade

- aplicação: **v3.5.1**;
- Universal: **v1.3.1**;
- `configVersion`: **9**;
- schema de Scripted Schedules: **1**;
- estado persistente de downloads: **5**.

Não existe migração de configuração, estado, mídia ou projetos de Scripted Schedule nesta atualização. Projetos já existentes continuam válidos e só ganham a nova ação no editor.

## Antes de atualizar

Pare o aplicativo. Como esta atualização não migra dados, não há backup obrigatório específico da v3.5.1, mas manter uma cópia recente de `config/` e `data/` continua sendo uma boa prática operacional.

## Aplicar o update

Extraia `ErsatzTV-YouTube-Downloader-v3.5.1-update.zip` sobre uma instalação **v3.5.0**:

```bash
cd /caminho/da/aplicacao
pm2 stop ersatztv-youtube-downloader
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.5.1-update.zip -d .
npm run verify
pm2 restart ersatztv-youtube-downloader --update-env
pm2 save
```

O pacote `update` não contém `config/config.json`, `config/auth.json` nem o conteúdo operacional de `data/`.

Depois do primeiro acesso, faça `Ctrl+F5` para garantir que o navegador carregue os arquivos JavaScript/CSS da v3.5.1.

## Verificação rápida

1. Abra **Scripted Schedules -> Programação** e expanda um módulo com pelo menos um item.
2. Confirme **Duplicar item** à esquerda e **Remover** à direita.
3. Duplique um item com ID e confirme que a cópia aparece imediatamente abaixo com `_copy` no ID.
4. Se existir **Nome opcional**, confirme o sufixo **(cópia)**.
5. Altere um campo ou estrutura interna da cópia e confirme que o original não muda.
6. Rode `npm run verify` e confirme que a suíte termina sem falhas.

## Rollback

Como a v3.5.1 não altera schema nem dados persistentes, o rollback para v3.5.0 consiste em restaurar os arquivos de código da versão anterior. Projetos salvos pela v3.5.1 continuam no mesmo formato usado pela v3.5.0.
