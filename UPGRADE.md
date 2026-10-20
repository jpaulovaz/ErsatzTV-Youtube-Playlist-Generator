# Atualização para 4.2.4

A versão 4.2.4 parte da **v4.2.3** e corrige o clique inicial das ações avançadas em **Ferramentas → Gerenciar legendas**. Não há mudança de configuração, banco/estado ou formato de arquivos.

## Versionamento

- aplicação: **v4.2.4**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **12**;
- Download state: **5**;
- Subtitle Manager state: **1**;
- Subtitle Workspace state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account config/state: **1**;
- Adoption transaction state: **1**.

Não há migração de schema nesta versão.

## O problema corrigido

Na v4.2.2 a tela foi simplificada e a seção usada para abrir formulários como **Extrair para editar** passou a existir somente depois que uma ação estivesse ativa. Porém o primeiro clique apenas tentava preencher essa seção se ela já existisse. Assim o estado interno mudava, mas nada aparecia na tela.

A v4.2.4 mantém essa área no DOM de forma invisível (`hidden`) e a revela quando necessário. Isso corrige no primeiro clique:

- Extrair para editar;
- Salvar no formato original;
- Criar cópia editável;
- Traduzir;
- Transformar em texto (OCR);
- Criar cópia do vídeo adicionando/removendo legenda.

O player não precisa ser reconstruído para abrir o formulário, portanto a posição atual do vídeo é preservada.

## Diagnóstico de extração

A extração passa a escrever em **Sistema → Logs**:

```text
Extracao de legenda iniciada no Gerenciador de Legendas.
Extracao de legenda concluida no Gerenciador de Legendas.
```

Em falhas aparece:

```text
Extracao de legenda falhou no Gerenciador de Legendas: ...
```

O log inclui item/faixa, arquivo gerado, duração e código/status quando disponíveis. Isso permite distinguir imediatamente um problema de interface de uma falha do FFmpeg/filesystem/rclone.

## Preciso configurar algo?

**Não.** A v4.2.4 não adiciona configuração. Streaming em tempo real, aceleração por hardware, Tesseract, Gemini e Bazarr permanecem exatamente como estavam na v4.2.3.

## Atualização

Pare o serviço e faça o backup normal da instalação. Depois extraia o update por cima da **v4.2.3**:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v4.2.3-to-v4.2.4-update.zip -d /caminho/da/aplicacao
```

Reinicie o serviço. Como `subtitleManager.js` recebe um novo cache-buster, um recarregamento normal do navegador deve buscar a versão nova; se o navegador mantiver uma aba antiga aberta, feche-a e abra novamente.

Para validar os arquivos do projeto:

```bash
npm run verify
```

O pacote update não inclui `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/`, API keys, tokens, mídia ou sidecars.
