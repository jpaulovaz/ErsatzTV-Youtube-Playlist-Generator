# Atualização para 4.0.2

A versão 4.0.2 parte da **v4.0.1** e compacta a saída bilíngue das traduções Gemini para reduzir a altura ocupada na tela.

## Versionamento

- aplicação: **v4.0.2**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **9**;
- Download state: **5**;
- Subtitle Manager state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account config/state: **1**;
- Adoption transaction state: **1**.

Nenhuma migração de configuração ou estado é necessária.

## O que muda

Nas saídas **Somente bilíngue** e **Traduzida + bilíngue**, cada cue passa a ser renderizado como:

```text
Original inteiro em uma linha
Tradução inteira em uma linha
```

Se o original ou a tradução contiverem quebras internas, elas são substituídas localmente por espaços apenas ao gerar a faixa bilíngue. A faixa somente traduzida mantém as quebras recebidas do tradutor.

A compactação não faz nova chamada ao Gemini, não altera capitalização, timestamps, quantidade de cues, tags ou arquivos-fonte.

## Atualização

Pare o serviço, faça backup normal da instalação e extraia o update por cima da v4.0.1:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v4.0.1-to-v4.0.2-update.zip -d /caminho/da/aplicacao
```

Depois reinicie o serviço e valide:

```bash
npm run verify
```

O pacote update não inclui `config/config.json`, `config/auth.json`, credenciais OAuth, `data/`, mídia ou sidecars.
