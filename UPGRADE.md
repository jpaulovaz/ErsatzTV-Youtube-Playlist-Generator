# Atualização para 3.9.2

A versão 3.9.2 é uma atualização incremental sobre a **v3.9.1** focada no Acervo local. Não há migração de configuração nem de estado.

## Versionamento

- aplicação: **v3.9.2**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **9**;
- download state: **5**;
- Scripted Schedules schema: **1**;
- Subtitle Manager state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account state/config: **1**;
- Adoption transaction state: **1**.

## Antes de atualizar

1. Pare o serviço/aplicativo.
2. Faça o backup normal de `config/` e `data/`.
3. Não altere nem apague `config/youtube-account.json`, `data/youtube-account-state.json` ou os estados do Gerenciador do YouTube.

## Aplicar o pacote update

Extraia o ZIP sobre uma instalação v3.9.1:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.9.1-to-v3.9.2-update.zip -d /caminho/da/aplicacao
```

O pacote update não contém `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/` nem mídia.

Reinicie o serviço depois da atualização e faça login novamente se a sessão administrativa tiver sido encerrada pelo restart.

## Nova varredura com progresso

Em **YouTube -> Gerenciador do YouTube -> Acervo local**, **Atualizar varredura** agora inicia um job em segundo plano. A notificação fixa no canto inferior direito mostra:

- nome da fonte e pasta raiz;
- arquivo atualmente inspecionado;
- quantidade processada e total;
- IDs recuperados;
- erros de leitura;
- barra de progresso e animação enquanto estiver ativo.

Ao concluir, a notificação muda para um resumo final e o catálogo é recarregado. Uma segunda varredura não é iniciada enquanto outra estiver ativa.

## Validar IDs recuperados

O novo botão **Validar IDs recuperados** elimina a necessidade de abrir centenas de itens individualmente quando o arquivo já contém um Video ID exato.

A ação considera IDs recuperados de:

- filename;
- `.info.json`;
- NFO;
- metadata embedded do contêiner.

Depois da confirmação do usuário, o backend valida os IDs via `videos.list` em lotes de até 50. Isso **não usa `search.list`**.

A confirmação em lote segue estas regras:

- Video ID duplicado/conflitante: fica para revisão manual;
- vídeo indisponível: fica para revisão manual;
- diferença de duração **acima de 45 s**: fica para revisão manual;
- diferença **acima de 10 s e até 45 s**: pode ser confirmada, mas é registrada com aviso;
- demais IDs válidos ficam com status **Confirmado** e passam a poder participar das ações em massa existentes.

A pesquisa/matching tradicional continua sem autoaprovação: o comportamento em lote vale apenas para um ID exato já recuperado do próprio acervo e somente depois da ação explícita **Validar IDs recuperados**.

## Correção visual

Foi adicionado espaçamento vertical consistente entre os cards do Acervo local. A **Fila de adoção** não fica mais encostada no card imediatamente acima.

## Validação

Para validar o pacote localmente:

```bash
npm run verify
```
