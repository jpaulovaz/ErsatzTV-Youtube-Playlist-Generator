# Atualização para 3.7.1

A versão 3.7.1 atualiza diretamente a **v3.7.0** e refina o módulo de tradução de legendas em dois pontos: acompanhamento da fila na **Visão geral** e suporte simultâneo a uma faixa traduzida e outra bilíngue compatível com seleção `und` no ErsatzTV.

## Versionamento

- aplicação: **v3.7.1**;
- Universal: **v1.3.1**;
- `configVersion`: **9**;
- download state: **5**;
- Scripted Schedules schema: **1**;
- subtitle-manager state: **1**;
- subtitle-translation config: **1**;
- subtitle-translation state: **1**.

Não há migração de `config.json`, de download state nem dos estados de tradução.

## Antes de atualizar

1. Confirme que a instalação está em **v3.7.0**.
2. Faça backup de `config/`, `data/` e das pastas de mídia.
3. Se houver tradução em massa em execução, prefira pausá-la antes de parar o serviço.
4. Pare o serviço antes de substituir os arquivos.

## Aplicando o update

```bash
sudo systemctl stop ersatztv-youtube-downloader
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.7.1-update.zip -d /caminho/da/aplicacao
cd /caminho/da/aplicacao
npm run verify
sudo systemctl start ersatztv-youtube-downloader
```

O update não contém `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `data/` nem mídia.

## Visão geral

A página **Visão geral** passa a mostrar um card próprio para a fila de tradução de legendas. Ele acompanha:

- estado do job;
- item atual;
- destino;
- concluídas;
- aguardando/em andamento;
- falhas;
- ignoradas;
- progresso total.

Quando existe job ativo, o card permite **Pausar/Retomar**. O botão **Gerenciar conteúdo** abre o destino do job quando ele foi criado pela v3.7.1 e possui o contexto de Biblioteca/Playlist salvo no estado.

Jobs antigos da v3.7.0 continuam executáveis; como eles não gravavam metadados de navegação do destino, o atalho pode ficar indisponível para um job já existente antes do update.

## Traduzida + bilíngue

Em **Gerenciar conteúdo -> Traduzir legendas**, o seletor de saída passa a oferecer:

- **Somente traduzida**;
- **Somente bilíngue**;
- **Traduzida + bilíngue**.

Quando as duas saídas são escolhidas, o Gemini traduz os cues uma única vez. Após a validação, o aplicativo monta os dois SRTs localmente.

Para um vídeo `Musica.mp4`, traduzindo `en -> pt-BR`:

```text
Musica.en.srt       original preservado
Musica.pt-BR.srt    somente tradução em Português (Brasil)
Musica.srt          bilíngue: original em cima + tradução embaixo
```

A faixa `Musica.srt` é tratada pelo aplicativo como idioma `und`. Essa convenção é reservada para a faixa bilíngue e permite selecioná-la no Custom Stream Selector do ErsatzTV, por exemplo:

```yaml
items:
  - audio_language: ["*"]
    subtitle_language: ["und*"]
    disable_subtitles: false
```

Para a tradução pura em Português (Brasil), continue usando `pt*`; para a original em inglês, `en*`.

## Preflight

A pré-análise agora mostra separadamente:

- traduções a gerar;
- bilíngues a gerar;
- traduzidas existentes;
- bilíngues existentes.

Com política **Ignorar**, se `.pt-BR.srt` já existir mas `.srt` não existir, o item continua elegível e somente a bilíngue é criada. O inverso também vale. Com **Substituir com histórico**, as saídas solicitadas são regravadas preservando as versões anteriores no histórico.

## Compatibilidade com bilíngues criadas na v3.7.0

Na v3.7.0 o modo bilíngue gravava a saída no próprio idioma-alvo, por exemplo `.pt-BR.srt`. A v3.7.1 **não renomeia nem apaga automaticamente** esse arquivo.

Se você já gerou bilíngues na v3.7.0 e quer passar ao novo formato mantendo as duas opções, execute um job com:

- saída **Traduzida + bilíngue**;
- política **Substituir com histórico**.

O resultado será `.pt-BR.srt` como tradução pura e `.srt` como bilíngue, com a versão anterior preservada pelo histórico.

## Validação após o update

1. Execute `npm run verify`.
2. Abra a **Visão geral** e confirme que o card **Tradução de legendas** aparece.
3. Em uma biblioteca pequena, faça o preflight `en -> pt-BR` com **Traduzida + bilíngue**.
4. Confirme que a estimativa de tokens não é duplicada apenas por gerar os dois formatos.
5. Traduza um item e confirme a presença de `.pt-BR.srt` e `.srt`.
6. Abra o Gerenciador de Legendas e confirme que a faixa sem sufixo aparece como **Bilíngue** e **ErsatzTV: und**.
7. No ErsatzTV, selecione `und*` para testar a bilíngue e `pt*` para testar a tradução pura.

## Rollback

Para rollback do aplicativo, restaure os arquivos da v3.7.0 preservando `config/`, `data/` e a mídia. Sidecars `.srt` criados pela v3.7.1 são arquivos normais e não são removidos automaticamente pelo rollback; uma v3.7.0 pode não interpretar a convenção bilíngue sem sufixo da mesma forma dentro do seu Gerenciador de Legendas.
