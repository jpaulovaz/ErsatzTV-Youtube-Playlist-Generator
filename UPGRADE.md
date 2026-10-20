# Atualização para 4.1.2

A versão 4.1.2 parte da **v4.1.1** e faz um ajuste de interface em **Ferramentas → Gerenciar legendas**.

## Versionamento

- aplicação: **v4.1.2**;
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

Ao clicar em um vídeo na fila de **Gerenciar legendas**, o bloco de edição agora é aberto imediatamente abaixo daquele card. O usuário não precisa mais rolar até o final da listagem para encontrar o player e os controles.

O editor inline inclui navegação anterior/próximo, ação **Revisado e próximo**, player, sincronização, histórico e área opcional do Bazarr. Ao selecionar outro vídeo, o mesmo editor é reposicionado sob o novo item. **Fechar gerenciador** fecha o contexto inline inteiro.

Também foi aumentado o espaçamento entre os cards da triagem e o item aberto passa a receber destaque visual. Não existe rolagem automática forçada.

## Atualização

Pare o serviço, faça backup normal da instalação e extraia o update por cima da v4.1.1:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v4.1.1-to-v4.1.2-update.zip -d /caminho/da/aplicacao
```

Depois reinicie o serviço e valide:

```bash
npm run verify
```

O pacote update não inclui `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/`, API keys, tokens, mídia ou sidecars.
