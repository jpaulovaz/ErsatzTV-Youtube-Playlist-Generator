# Atualização para 4.2.1

A versão 4.2.1 parte da **v4.2.0** e reformula a reprodução usada em **Ferramentas → Gerenciar legendas** para evitar a preparação antecipada de um preview completo quando o navegador não consegue reproduzir o áudio de um MKV. O foco é especialmente útil em bibliotecas montadas por rclone ou outros storages remotos: a compatibilidade é produzida enquanto o usuário assiste e a navegação para outro ponto reinicia o stream próximo daquele instante.

## Versionamento

- aplicação: **v4.2.1**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **12**;
- Download state: **5**;
- Subtitle Manager state: **1**;
- Subtitle Workspace state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account config/state: **1**;
- Adoption transaction state: **1**.

A única migração de schema é `configVersion 11 → 12`, adicionando o bloco `playback`. Não há migração dos arquivos de estado.

## O que muda na reprodução

O Gerenciador de Legendas passa a escolher entre três caminhos:

1. **Direct Play** — usa o arquivo original quando ele já é adequado ao navegador.
2. **Direct Stream** — para casos como MKV/H.264 + DTS/AC3, mantém o vídeo sem recodificação e converte apenas o áudio para AAC em tempo real.
3. **Transcode em tempo real** — quando o vídeo também precisa de conversão, produz H.264 + AAC enquanto o usuário assiste. A aplicação tenta um encoder por hardware e volta automaticamente para CPU se o teste real do acelerador falhar.

O preview completo da v4.2.0 continua disponível como **fallback manual**. Ele deixa de ser a primeira opção para MKV com áudio incompatível.

### Navegação/seek

O stream compatível não precisa preparar o filme inteiro. O editor mostra uma linha do tempo referente à duração completa da mídia. Ao saltar para outro ponto, o processo atual é encerrado e um novo stream começa próximo do tempo escolhido, mantendo a legenda referenciada ao relógio absoluto do filme.

Isso reduz leitura e processamento desnecessários em arquivos remotos, embora a latência final continue dependendo do próprio rclone, da origem remota, do cache e da conexão.

## Aceleração por hardware

Em **Configurações → Reprodução de vídeos**, o padrão é:

- **Streaming compatível em tempo real:** ativado;
- **Aceleração:** `Automático (recomendado)`;
- **Dispositivo VAAPI:** `/dev/dri/renderD128`.

O modo automático procura encoders compatíveis na build do FFmpeg e executa um pequeno teste antes de selecionar o backend. A aplicação reconhece, quando disponíveis:

- NVIDIA NVENC;
- Intel Quick Sync (QSV);
- VAAPI em Linux (Intel/AMD);
- AMD AMF;
- Apple VideoToolbox.

Se nenhum backend for validado, o aplicativo usa `libx264` por CPU. Falha de aceleração **não impede** a reprodução.

A aceleração é usada quando há necessidade de recodificar vídeo. No caso mais eficiente — vídeo já compatível e apenas áudio incompatível — o vídeo continua em stream copy e somente o áudio é convertido para AAC pela CPU.

## Preciso configurar algo extra?

### Instalação direta no host

Na configuração padrão, **não é necessário alterar nada no aplicativo**. Se o FFmpeg instalado enxergar um acelerador funcional, `Automático` o utilizará. Caso contrário, haverá fallback para CPU.

### Docker / container

Para usar GPU dentro de um container, o dispositivo e o runtime precisam estar disponíveis para o container. Isso é uma configuração do ambiente, não uma obrigação da aplicação.

**Intel/AMD em Linux (VAAPI/QSV):** normalmente é necessário expor `/dev/dri` e garantir que o usuário do processo tenha permissão sobre os dispositivos `render`/`video`. Exemplo conceitual de Compose:

```yaml
devices:
  - /dev/dri:/dev/dri
```

Se o render node do host for diferente, ajuste **Dispositivo VAAPI** na interface.

**NVIDIA:** é necessário que o host possua driver NVIDIA, que o container tenha acesso à GPU (normalmente via NVIDIA Container Toolkit/runtime) e que a build do FFmpeg contenha NVENC. A aplicação não instala drivers nem modifica o runtime Docker.

Se você não quiser configurar GPU agora, mantenha **Automático**. O aplicativo continuará funcionando pela CPU.

### rclone

Não há configuração nova obrigatória para rclone. O ganho vem do fato de o aplicativo deixar de exigir a geração antecipada do preview completo. Cache/VFS e parâmetros próprios do rclone continuam sob controle da sua montagem atual.

## Migração automática

Ao iniciar a v4.2.1 sobre uma configuração v11, é acrescentado:

```json
{
  "playback": {
    "liveCompatibilityStreaming": true,
    "hardwareAcceleration": "auto",
    "vaapiDevice": "/dev/dri/renderD128"
  }
}
```

Todos os demais valores existentes são preservados.

## Atualização

Pare o serviço e faça o backup normal da instalação. Depois extraia o update por cima da **v4.2.0**:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v4.2.0-to-v4.2.1-update.zip -d /caminho/da/aplicacao
```

Reinicie o serviço e, se desejar, confira **Configurações → Reprodução de vídeos**. Para validar os arquivos do projeto:

```bash
npm run verify
```

O pacote update não inclui `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/`, API keys, tokens, mídia ou sidecars.
