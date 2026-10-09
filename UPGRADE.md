# Atualização para 3.9.0

A versão 3.9.0 atualiza diretamente a **v3.8.0** e entrega a segunda fase do **Gerenciador do YouTube**: adoção de mídia local já existente sem redownload. A v3.8.0 continua sendo a base obrigatória do pacote update. Não há migração do `config.json`, da fila de downloads, do Subtitle Manager, da tradução, dos Scripted Schedules, do YouTube Manager state nem do YouTube Account state.

## Versionamento

- aplicação: **v3.9.0**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **9**;
- download state: **5**;
- Scripted Schedules schema: **1**;
- Subtitle Manager state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account state/config: **1**;
- Adoption transaction state: **1 (novo)**.

## Antes de atualizar

1. Pare o serviço/aplicativo.
2. Faça backup de `config/` e `data/`.
3. Preserve normalmente suas bibliotecas e o acervo local de origem.
4. Não crie manualmente `youtube-adoption-state.json`; ele será criado sob demanda.
5. Para adotar um vídeo, confirme primeiro a correspondência no **Acervo local** e sincronize o destino gerenciado para que o mesmo Video ID já exista como item ativo da fonte. A adoção não cria itens órfãos artificialmente.

## Aplicar o pacote update

Extraia o ZIP sobre a instalação v3.8.0:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.8.0-to-v3.9.0-update.zip -d /caminho/da/aplicacao
```

O pacote de atualização não contém `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/` nem arquivos de mídia.

## Adoção de mídia existente

Na aba **Acervo local**, itens com correspondência YouTube confirmada passam a oferecer **Adotar**. Também é possível selecionar vários itens confirmados e abrir o preflight em massa.

A adoção só é liberada quando:

- o arquivo continua dentro da raiz de acervo autorizada;
- a correspondência está confirmada e não existe conflito do mesmo Video ID com outro arquivo local;
- o vídeo já existe como item ativo no destino gerenciado escolhido;
- o arquivo local atende ao padrão de mídia já usado pelo aplicativo (MP4/H.264/AAC); a v3.9.0 não transcodifica silenciosamente durante a adoção;
- o caminho final pode ser determinado e não existe mídia/sidecar conflitante no destino;
- o vídeo confirmado continua disponível na YouTube Data API;
- a diferença entre duração local e YouTube não supera **45 segundos**.

Diferença de duração **acima de 10 segundos até 45 segundos** gera aviso no preflight, mas não bloqueia. Acima de 45 segundos bloqueia a adoção. Esses limites são fixos nesta versão.

### Modos

- **Hardlink**: padrão preferencial. Exige origem e destino no mesmo filesystem; não duplica os bytes e não remove a origem.
- **Copy**: copia a mídia para o caminho gerenciado e preserva a origem. O preflight verifica espaço livre/reserva antes do commit.
- **Move**: opção destrutiva explícita com confirmação reforçada. O aplicativo cria/valida primeiro a cópia gerenciada e remove **somente o arquivo de vídeo da origem** no commit final.

Ninguém dos três modos sobrescreve silenciosamente um arquivo existente.

### Sidecars antigos

NFO, imagens, SRTs e demais sidecars encontrados junto ao arquivo antigo permanecem **intactos na origem**. Eles servem apenas como sinais de identificação durante o catálogo.

No destino gerenciado, a v3.9.0 usa os mesmos perfis e geradores atuais para criar NFO/artwork/metadata. Legendas e traduções **não são disparadas automaticamente pela adoção**; depois do commit, o item passa a usar normalmente o Subtitle Manager e os demais fluxos já existentes.

## Transação, rollback e restart

Cada adoção cria um manifesto persistente em `data/youtube-adoption-state.json` antes de tocar o destino. Se uma etapa posterior falhar:

- somente os artefatos criados por aquela transação são removidos;
- o estado gerenciado anterior é restaurado;
- o estado de adoção do catálogo é restaurado;
- a origem é preservada;
- em Move, se a remoção final da origem já tiver ocorrido, a transação tenta restaurá-la a partir da mídia gerenciada antes de encerrar o rollback.

Ao iniciar a aplicação, transações interrompidas são recuperadas/rollbackadas antes da fila de adoção voltar a operar. A fila é persistente, serializada e pode ser pausada, retomada ou ter pendentes cancelados.

Enquanto uma transação de adoção altera o destino, o Download Manager não inicia outro download. Se já houver download ativo, a adoção aguarda/reagenda em vez de disputar os mesmos caminhos.

## OAuth, pesquisa e playlists

A Fase 1 permanece inalterada. Pesquisa pública, OAuth, catálogo/matching e fila de playlists continuam usando os estados v1 existentes. O callback padrão permanece:

```text
https://yt.johnflix.com.br/api/youtube-manager/oauth/callback
```

## Validação após atualizar

Execute:

```bash
npm run verify
```

Depois, para validar a nova função com baixo risco:

1. abra **YouTube -> Gerenciador do YouTube -> Acervo local**;
2. escolha um item pequeno cuja correspondência esteja confirmada;
3. confirme que esse Video ID já aparece como item ativo no destino gerenciado;
4. abra **Adotar** e execute primeiro o preflight em **Hardlink**;
5. confira origem, caminho de destino, duração e avisos;
6. conclua a adoção e valide mídia, NFO/artwork e estado gerenciado;
7. confirme que os sidecars antigos na origem permanecem intactos;
8. somente depois teste Copy ou Move, se necessários.

## Rollback da atualização

Para voltar à v3.8.0, pare a aplicação e restaure os arquivos da v3.8.0 preservando `config/`, `data/` e mídia. A v3.8.0 ignora o novo `data/youtube-adoption-state.json` e os campos opcionais de aquisição/adoção mantidos nos estados existentes.

A restauração do software **não desfaz adoções já concluídas**. Se uma mídia já foi adotada para uma biblioteca, trate os arquivos resultantes como conteúdo normal desse destino antes de qualquer rollback manual de dados.
