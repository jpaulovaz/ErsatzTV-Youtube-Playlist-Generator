# Atualização para 4.2.5

A versão 4.2.5 parte da **v4.2.4** e corrige a reprodução/navegação de MP4 em **Ferramentas → Gerenciar legendas**. Não há mudança de configuração, banco/estado ou formato de arquivos.

## Versionamento

- aplicação: **v4.2.5**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **12**;
- Download state: **5**;
- Subtitle Manager state: **1**;
- Subtitle Workspace state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account config/state: **1**;
- Adoption transaction state: **1**.

## O que muda

### MP4 com áudio, mas sem faixa listada

Se o FFprobe não conseguir analisar o arquivo dentro do tempo disponível, o navegador ainda pode tocar o MP4 normalmente. A v4.2.5 deixa de interpretar essa situação como ausência de áudio. A interface mostra **Áudio automático** e mantém a reprodução usando a faixa padrão do próprio arquivo.

Falhas de análise também deixam de ficar memorizadas indefinidamente: o aplicativo volta a tentar a leitura técnica depois de um intervalo curto.

### Barra para avançar e voltar

A barra **Navegar no vídeo** agora aparece também em MP4 reproduzido diretamente. Quando a duração não veio do FFprobe, ela é preenchida assim que o navegador lê os metadados do vídeo.

- reprodução direta: o seek usa o próprio arquivo/HTTP Range;
- streaming compatível: o stream é reiniciado próximo do ponto escolhido, como já acontecia nos MKV.

### Fallback automático

Quando a análise técnica falha em MP4/M4V/WebM, o aplicativo tenta primeiro tocar o arquivo original. Se o navegador não conseguir, o Gerenciador de Legendas muda automaticamente para o streaming compatível.

## Precisa configurar algo?

**Não.** A v4.2.5 não adiciona configuração. Streaming em tempo real, aceleração por hardware, Tesseract, Gemini e Bazarr permanecem exatamente como estavam na v4.2.4.

## Atualização

Pare o serviço e faça o backup normal da instalação. Depois extraia o update por cima da **v4.2.4**:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v4.2.4-to-v4.2.5-update.zip -d /caminho/da/aplicacao
```

Inicie novamente o serviço. Recomenda-se recarregar a página para garantir o JavaScript v4.2.5.
