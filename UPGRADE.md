# Atualização para 3.9.8

A versão 3.9.8 é uma atualização incremental sobre a **v3.9.7**, focada na atualização imediata da visão filtrada de **Gerenciar conteúdo** depois de mudanças em legendas. Não há migração de configuração, estado ou schema.

## Versionamento

- aplicação: **v3.9.8**;
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

Pare o serviço, faça backup da instalação e extraia o pacote incremental sobre a instalação v3.9.7:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.9.7-to-v3.9.8-update.zip -d /caminho/da/aplicacao
```

Depois reinicie o serviço. O pacote não substitui `config/config.json`, `config/auth.json`, `config/youtube-account.json`, `data/` nem arquivos de mídia.

## Correção do filtro de legendas

Antes da v3.9.8, o backend salvava corretamente a nova legenda e atualizava o Download State, mas a listagem já aberta em **Gerenciar conteúdo** continuava usando o snapshot anterior. Por isso um item filtrado em **Sem legendas** permanecia visível até sair e voltar da página.

Na v3.9.8, o Gerenciador de Legendas avisa a tela principal depois de qualquer mutação que altere a presença da legenda:

- **Aplicar** uma legenda encontrada no YouTube;
- **Aplicar** uma legenda encontrada no LRCLIB;
- **Restaurar** uma versão do histórico;
- **Excluir** uma legenda ativa.

A tela recarrega a visão atual mantendo o filtro selecionado. Se o item não pertencer mais ao resultado atual, ele é removido imediatamente e os contadores são atualizados. Se continuar pertencendo à visão, o painel de detalhes é atualizado sem abandonar a página.

## Validação após atualizar

1. Abra uma Biblioteca ou Playlist de Canal em **Gerenciar conteúdo**.
2. Selecione **Sem legendas**.
3. Abra um item e aplique uma legenda via **YouTube** ou **LRCLIB**.
4. Confirme que o item desaparece imediatamente do resultado filtrado e que a contagem de **Sem legendas** diminui.
5. Em **Com legendas**, exclua a última legenda de um item e confirme que ele deixa essa visão imediatamente.

Nenhuma fila de downloads, tradução, YouTube Manager, OAuth ou estado de adoção é alterado por esta atualização.
