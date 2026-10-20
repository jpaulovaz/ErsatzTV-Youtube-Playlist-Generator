# Atualização para 4.2.2

A versão 4.2.2 parte da **v4.2.1** e concentra a mudança em **Ferramentas → Gerenciar legendas**. Nenhum formato de arquivo, configuração ou estado é migrado. O objetivo é deixar a oficina mais simples de entender e tornar explícito quando uma ação ainda está trabalhando, especialmente em arquivos remotos.

## Versionamento

- aplicação: **v4.2.2**;
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

## Tela mais simples

A tela mantém à frente o fluxo normal: escolher um vídeo, reproduzir, escolher a legenda e fazer o ajuste necessário. Recursos de uso menos frequente ficam recolhidos e podem ser abertos quando forem necessários.

As explicações longas e detalhes de diagnóstico foram movidos para botões **?**. Termos internos como codec, índice da faixa e formato continuam disponíveis para diagnóstico, mas deixam de competir visualmente com as ações do dia a dia.

Alguns nomes também foram trocados por descrições de tarefa, por exemplo:

- waveform → **Forma de onda**;
- spectrogram → **Mapa de frequências**;
- cue → **trecho**;
- OCR → **Transformar em texto**;
- remux → **Criar cópia do vídeo**;
- conversão para SRT → **Criar cópia editável**.

## Andamento das operações

Toda operação relevante feita sobre o vídeo ou a legenda passa a mostrar um cartão de andamento dentro do editor. Ele aparece imediatamente após a confirmação e informa o que está acontecendo.

Isso cobre, entre outras ações:

- extrair uma legenda de dentro do vídeo;
- criar uma cópia editável;
- preparar uma versão temporária para reprodução;
- criar forma de onda ou mapa de frequências;
- salvar texto/horários e sincronização;
- restaurar ou excluir uma legenda;
- aplicar uma legenda encontrada;
- traduzir;
- transformar legenda em imagem em texto;
- criar cópias de vídeo.

Quando o backend fornece progresso real — atualmente nos jobs de tradução, reconhecimento de texto e criação de cópias de vídeo — o cartão mostra **percentual**. Em operações síncronas nas quais o FFmpeg ou filesystem não fornece um percentual confiável ao navegador, a interface mostra uma barra animada e o **tempo decorrido**, em vez de inventar uma porcentagem.

Ao terminar, o cartão informa sucesso e duração. Em erro, a mensagem permanece visível até ser fechada ou uma nova operação começar.

## Preciso configurar algo?

**Não.** A v4.2.2 não acrescenta nenhuma configuração. Streaming em tempo real, aceleração por hardware, Tesseract, Gemini e Bazarr continuam exatamente com as configurações da v4.2.1.

## Atualização

Pare o serviço e faça o backup normal da instalação. Depois extraia o update por cima da **v4.2.1**:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v4.2.1-to-v4.2.2-update.zip -d /caminho/da/aplicacao
```

Reinicie o serviço. Para validar os arquivos do projeto:

```bash
npm run verify
```

O pacote update não inclui `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/`, API keys, tokens, mídia ou sidecars.
