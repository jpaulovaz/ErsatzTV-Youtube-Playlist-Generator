# Atualização para 3.10.0

A versão 3.10.0 reorganiza o **Gerenciador do YouTube** para priorizar o fluxo diário **Destino → Pesquisa → Adicionar**, mantendo recuperação de acervo, filas, OAuth e adoção como ferramentas completas porém secundárias. A atualização parte da **v3.9.8** e não exige migração de configuração, estado ou schema.

## Versionamento

- aplicação: **v3.10.0**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **9**;
- Download state: **5**;
- Scripted Schedules schema: **1**;
- Subtitle Manager state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account config/state: **1**;
- Adoption transaction state: **1**.

## Atualização

Pare o serviço, faça backup da instalação e extraia o pacote incremental sobre a instalação v3.9.8:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.9.8-to-v3.10.0-update.zip -d /caminho/da/aplicacao
```

Depois reinicie o serviço. O pacote não substitui `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/` nem arquivos de mídia.

## O que mudou no Gerenciador do YouTube

A navegação principal passa a ter quatro áreas:

1. **Adicionar vídeos** — tela inicial e fluxo principal. Escolha uma Biblioteca/Playlist de Canal ou playlist do YouTube, pesquise e adicione diretamente no resultado.
2. **Atividade** — reúne fila de inserção, fila de adoção e histórico recente.
3. **Recuperar acervo** — ferramenta de manutenção para arquivos que já existem localmente; scanner, matching, validação de IDs e adoção ficam aqui.
4. **Configurações** — OAuth, quota e manutenção/criação de playlists da conta.

O topo agora mostra estados rápidos de **Conta Google**, **Atividade** e **Quota hoje**. Ajuda contextual `?`, o botão **Como funciona?**, estados vazios orientativos e seções avançadas recolhidas reduzem o número de controles visíveis ao mesmo tempo.

## Destino antes da pesquisa

O novo seletor **Onde deseja adicionar?** cruza a configuração local com as playlists pertencentes à conta OAuth:

- Bibliotecas e Playlists de Canal alimentadas por playlists da conta aparecem primeiro;
- playlists da conta sem vínculo local aparecem em **Somente no YouTube**;
- se uma Biblioteca tiver mais de uma fonte elegível, cada playlist é identificada separadamente;
- selecionar um destino gerenciado deixa explícita a playlist YouTube que o alimenta.

Depois que a fila de inserção terminar, destinos gerenciados oferecem **Sincronizar biblioteca agora** ou **Sincronizar playlist agora**, sem obrigar o usuário a navegar para outra área.

## Recuperação de acervo

Nenhuma capacidade foi removida. A ferramenta continua com varredura em background, validação individual/em lote de Video IDs, filtros de presença em Biblioteca/playlist, seleção em massa, matching manual e adoção Hardlink/Copy/Move. O cadastro/remoção de pastas e as explicações avançadas ficam recolhidos por padrão.

## Validação após atualizar

1. Abra **YouTube → Gerenciador do YouTube** e confirme que a tela inicial é **Adicionar vídeos**.
2. Confirme que **Onde deseja adicionar?** lista primeiro Bibliotecas/Playlists de Canal vinculadas às playlists da conta.
3. Pesquise por um vídeo e confirme que a ação de adicionar permanece na mesma tela.
4. Abra **Atividade** e confirme que as duas filas aparecem juntas.
5. Abra **Recuperar acervo** e confirme que suas fontes, filtros, matches e estados anteriores continuam preservados.
6. Abra **Configurações** e confirme conta OAuth, quota e playlists.

Não há alteração na semântica das filas, quota, adoção, downloads, legendas, tradução ou Scripted Schedules.
