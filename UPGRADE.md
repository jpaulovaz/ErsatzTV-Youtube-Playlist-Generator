# Atualização para 4.1.1

A versão 4.1.1 parte da **v4.1.0** e corrige o cadastro de pastas amplas no **Ferramentas → Gerenciar legendas**.

## Versionamento

- aplicação: **v4.1.1**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **10**;
- Download state: **5**;
- Subtitle Manager state: **1**;
- Subtitle Workspace state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account config/state: **1**;
- Adoption transaction state: **1**.

Não há migração de configuração nem de estado.

## O que muda

Na v4.1.0 caminhos classificados como amplos eram bloqueados. Isso atingia mountpoints válidos diretamente sob `/`, por exemplo `/gay_movies`.

Na v4.1.1 o bloqueio de amplitude vira confirmação: ao cadastrar um caminho amplo, a interface explica que a varredura pode percorrer muitos arquivos e oferece **Usar esta pasta**. Confirmando, o workspace é cadastrado normalmente e as próximas varreduras não pedem nova confirmação.

Continuam como bloqueios reais apenas as proteções técnicas: caminho deve ser absoluto, existir, ser diretório real e não ser symlink; o scanner não segue symlinks internos e todas as operações permanecem confinadas à raiz cadastrada.

## Atualização

Pare o serviço, faça backup normal da instalação e extraia o update por cima da v4.1.0:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v4.1.0-to-v4.1.1-update.zip -d /caminho/da/aplicacao
```

Depois reinicie o serviço e valide:

```bash
npm run verify
```

O pacote update não inclui `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/`, API keys, tokens, mídia ou sidecars.
