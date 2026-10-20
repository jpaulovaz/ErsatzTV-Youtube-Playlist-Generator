# Atualização para 4.2.0

A versão 4.2.0 parte da **v4.1.2** e transforma **Ferramentas → Gerenciar legendas** em uma oficina completa de conferência, edição, conversão e preparação de legendas. O foco é permitir que uma pessoa sem conhecimento de codecs ou contêineres consiga assistir, ouvir, extrair, traduzir e corrigir uma legenda sem alterar o arquivo de vídeo original por acidente.

## Versionamento

- aplicação: **v4.2.0**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **11**;
- Download state: **5**;
- Subtitle Manager state: **1**;
- Subtitle Workspace state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account config/state: **1**;
- Adoption transaction state: **1**.

A única migração de configuração desta versão é `configVersion 10 → 11`, adicionando `paths.tesseractPath` com o padrão `/usr/bin/tesseract`. Não há migração dos arquivos de estado.

## O que muda

### Reprodução de MKV e áudio

Ao abrir um vídeo no Gerenciador de Legendas, o FFprobe identifica contêiner, vídeo e faixas de áudio. A interface mostra a faixa de áudio escolhida e decide entre três comportamentos:

- reprodução direta quando o navegador deve suportar o arquivo;
- prévia compatível com **vídeo copiado + áudio AAC** quando o vídeo já é adequado, mas o contêiner/áudio pode falhar no navegador;
- prévia **H.264 + AAC** sob comando do usuário quando também é necessário converter o vídeo.

O botão de prévia compatível permanece disponível como alternativa manual. O arquivo original não é substituído.

### Edição e sincronização avançada

- waveform e espectrograma gerados sob demanda pelo FFmpeg;
- clique na visualização para navegar até o ponto correspondente do vídeo;
- editor de cues SRT com início, fim e texto;
- sincronização por dois pontos com pré-visualização antes de salvar;
- correção explícita de FPS com pré-visualização;
- histórico/fingerprint continuam protegendo contra sobrescrita de alterações externas.

### Extração, conversão, tradução e OCR

- faixas textuais embutidas podem ser extraídas para SRT;
- ASS/SSA/VTT externos podem gerar uma **cópia SRT editável**, preservando o original;
- SRT externo pode ser traduzido no próprio workspace usando o mesmo núcleo Gemini das Bibliotecas;
- PGS/SUP pode ser convertido para SRT por OCR com Tesseract;
- idioma desconhecido (`und`) exige confirmação do usuário em vez de ser presumido.

A conversão ASS/SSA → SRT simplifica recursos que SRT não representa, como estilos, posicionamento, karaokê e efeitos. Por isso o arquivo original é sempre preservado.

### Cópias MKV

O menu das faixas permite criar uma **nova cópia MKV** adicionando uma legenda externa ou removendo uma legenda embutida. O fluxo usa stream copy, preserva metadados/capítulos, valida a nova cópia com FFprobe e remove o resultado se a validação falhar. O arquivo original não é substituído.

## Dependência opcional para OCR

O restante do Gerenciador de Legendas funciona sem Tesseract. Para usar **OCR de PGS/SUP**, instale o Tesseract no host/container do aplicativo e confirme o caminho em **Configurações → Caminho do Tesseract OCR**.

Para conferir a instalação:

```bash
/usr/bin/tesseract --version
/usr/bin/tesseract --list-langs
```

Pacotes de idioma precisam existir no Tesseract para o idioma desejado. Quando o pacote solicitado não estiver disponível, a interface/backend aplica o fallback disponível e informa o idioma OCR usado no resultado.

## Atualização

Pare o serviço e faça o backup normal da instalação. Depois extraia o update por cima da **v4.1.2**:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v4.1.2-to-v4.2.0-update.zip -d /caminho/da/aplicacao
```

Reinicie o serviço. No primeiro carregamento, `configVersion 10` é convertido automaticamente para `11` e recebe:

```json
{
  "paths": {
    "tesseractPath": "/usr/bin/tesseract"
  }
}
```

Os demais valores existentes são preservados.

Por fim, valide:

```bash
npm run verify
```

O pacote update não inclui `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/`, API keys, tokens, mídia ou sidecars.
