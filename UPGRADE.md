# Atualização para 4.1.0

A versão 4.1.0 parte da **v4.0.3** e adiciona o novo grupo **Ferramentas**, com **Recuperar acervo** e **Gerenciar legendas** para arquivos externos.

## Versionamento

- aplicação: **v4.1.0**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **10**;
- Download state: **5**;
- Subtitle Manager state: **1**;
- **Subtitle Workspace state: 1 (novo)**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account config/state: **1**;
- Adoption transaction state: **1**.

## Migração automática de configuração

No primeiro carregamento após o update, um `config/config.json` v9 é migrado automaticamente para v10. A migração preserva os valores existentes e acrescenta a integração Bazarr desativada por padrão:

```json
"bazarr": {
  "enabled": false,
  "url": "http://localhost:6767",
  "apiKey": "",
  "timeoutSeconds": 20,
  "pathMappings": []
}
```

O update **não** substitui `config/config.json`; a mudança acima é executada pelo próprio aplicativo de forma atômica. Faça o backup normal de `config/` e `data/` antes da atualização.

## O que muda

- **Recuperar acervo** sai da navegação interna do Gerenciador do YouTube e passa para **Ferramentas**, sem perda de funcionalidade.
- **Gerenciar legendas** permite cadastrar uma pasta de filmes/séries e varrer recursivamente seus vídeos e sidecars.
- SRT pode ser testado no player, atrasado/adiantado, salvo, restaurado pelo histórico ou excluído de forma recuperável.
- ASS/SSA/VTT/SUB/IDX/SUP e legendas embutidas são exibidos como somente leitura nesta primeira versão.
- A varredura não segue symlinks; caminhos amplos/perigosos são rejeitados e as operações ficam confinadas à raiz cadastrada.
- Alteração externa de um SRT aberto é detectada antes de salvar para evitar sobrescrever mudanças feitas por Bazarr/outro processo.
- A integração Bazarr é opcional. Quando configurada, oferece matching por caminho, busca/download manual e tentativa de sincronização da legenda ativa.

## Configurar Bazarr (opcional)

Abra **Configurações → Integrações → Bazarr**, informe URL e API Key e, quando o aplicativo e Bazarr enxergarem a mídia por caminhos diferentes, cadastre uma regra por linha:

```text
/mnt/media/Movies = /movies
/mnt/media/TV = /tv
```

O lado esquerdo é o caminho visto por este aplicativo; o lado direito deve corresponder ao caminho usado/retornado pelo seu ambiente Bazarr/Sonarr/Radarr. Use **Testar Bazarr** antes de pesquisar legendas.

## Atualização

Pare o serviço, faça backup normal da instalação e extraia o update por cima da v4.0.3:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v4.0.3-to-v4.1.0-update.zip -d /caminho/da/aplicacao
```

Depois reinicie o serviço. Na primeira carga, confirme em **Configurações** que o `configVersion` foi migrado e valide:

```bash
npm run verify
```

O pacote update não inclui `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/`, API keys, tokens, mídia ou sidecars.
