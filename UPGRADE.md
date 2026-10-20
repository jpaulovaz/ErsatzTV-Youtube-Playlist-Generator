# Atualização para 4.2.3

A versão 4.2.3 parte da **v4.2.2** e corrige a experiência de andamento em **Ferramentas → Gerenciar legendas**. Não há mudança de configuração, banco/estado ou formato de arquivos.

## Versionamento

- aplicação: **v4.2.3**;
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

## O que muda no Gerenciador de Legendas

O cartão de andamento que ficava dentro do editor foi removido. As ações passam a usar o mesmo aviso flutuante do canto inferior direito já utilizado nas varreduras do aplicativo.

Ao confirmar uma operação como **Extrair legenda**, o feedback aparece imediatamente:

```text
Extraindo legenda
Lendo a faixa dentro do vídeo e criando o arquivo...
[spinner]
```

O botão fica temporariamente bloqueado e muda para **Extraindo...**, evitando cliques duplicados e deixando claro que a ação foi recebida.

O mesmo padrão vale para extração, criação de cópia editável, forma de onda, mapa de frequências, preview compatível, salvamento, sincronização, restauração, exclusão, tradução, OCR e criação de cópias de vídeo.

Quando a tarefa fornece um percentual real, como tradução/OCR/remux, o aviso também mostra a barra de progresso. Quando não existe percentual confiável, aparece apenas a animação de carregamento; a interface não inventa porcentagens.

Ao finalizar, o aviso informa sucesso ou erro. Extração e conversão exibem também o nome do arquivo criado quando disponível.

## Preciso configurar algo?

**Não.** A v4.2.3 não adiciona configuração. Streaming em tempo real, aceleração por hardware, Tesseract, Gemini e Bazarr permanecem exatamente como estavam na v4.2.2.

## Atualização

Pare o serviço e faça o backup normal da instalação. Depois extraia o update por cima da **v4.2.2**:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v4.2.2-to-v4.2.3-update.zip -d /caminho/da/aplicacao
```

Reinicie o serviço. Para validar os arquivos do projeto:

```bash
npm run verify
```

O pacote update não inclui `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/`, API keys, tokens, mídia ou sidecars.
