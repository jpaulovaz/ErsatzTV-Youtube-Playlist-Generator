# Atualização para 4.0.0

A versão 4.0.0 reorganiza a experiência do **aplicativo inteiro** com foco em uso intuitivo por pessoas que não precisam conhecer a arquitetura interna. A atualização parte da **v3.10.0** e preserva todas as capacidades, configurações e estados existentes.

## Versionamento

- aplicação: **v4.0.0**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **9**;
- Download state: **5**;
- Scripted Schedules schema: **1**;
- Subtitle Manager state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account config/state: **1**;
- Adoption transaction state: **1**.

Não há migração de schema.

## Atualização

Pare o serviço, faça backup da instalação e extraia o pacote incremental sobre a v3.10.0:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.10.0-to-v4.0.0-update.zip -d /caminho/da/aplicacao
```

Reinicie o serviço. O pacote update não substitui `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `config/youtube-account.json`, `data/` nem arquivos de mídia.

## O que mudou

### Visão geral

Passa a ser um painel de decisão: **Adicionar vídeos**, **Buscar novidades**, **Ver downloads** e **Bibliotecas** ficam como ações rápidas. Um cartão de atenção prioriza automaticamente pouco disco, falhas, fila pausada e operação em andamento. Os resumos de Downloads, Bibliotecas, Canais e armazenamento são clicáveis.

### Downloads

A fila fica aberta por padrão e os estados essenciais aparecem primeiro: estado, ativo, pendentes, falhas e disco. Contadores históricos e diagnóstico ficam em **Detalhes técnicos da fila**.

### Bibliotecas

A tela mostra resumo de quantidade, pendências, problemas e tamanho do acervo, permite pesquisar Bibliotecas e mantém **Gerenciar conteúdo** como o local para vídeos, legendas, tradução, órfãos, quarentena e ignorados. Exclusão/remoção ficam sob opções avançadas.

### Canais

Mostra saúde dos canais antes da configuração. Adicionar canal vira um fluxo explícito **informar URL → analisar → revisar fontes/playlist → salvar**. Remoção e exclusão de arquivos ficam sob **Mais opções**.

### Scripted Schedules

A tela inicial resume projetos publicados/rascunhos e mostra o fluxo em cinco etapas. O editor mantém todos os recursos do Universal v1.3.1 e ganha navegação por etapas mais evidente. Histórico, duplicação, reset e exclusão ficam em **Mais opções**.

### Ajuda

Deixa de ser somente documentação de Scripted Schedules e passa a cobrir **Comece aqui, Uso diário, Bibliotecas, Downloads, Canais, Adicionar vídeos, Scripted Schedules e Problemas comuns**. A referência profunda de módulos, Queries e glossário permanece dentro de Scripted Schedules.

### Configurações e Logs

Configurações recebe busca, resumo do estado e grupos **Essencial, Integrações, Automação e Avançado**. `yt-dlp avançado` fica por último. Logs passa a se apresentar como ferramenta de diagnóstico, não como tela que precisa ser monitorada.

## Validação após atualizar

1. Abra **Visão geral** e confirme ações rápidas, cartão de atenção e resumos clicáveis.
2. Abra **Downloads** e confirme que a fila está visível sem abrir manualmente a sanfona.
3. Abra **Bibliotecas** e **Canais** e confirme os resumos e ações avançadas recolhidas.
4. Abra **Scripted Schedules** e confirme a visão em etapas e seus projetos existentes.
5. Abra **Ajuda** e confirme que ela cobre o aplicativo inteiro.
6. Abra **Configurações**, pesquise por `API Key` e confirme que somente seções relacionadas permanecem visíveis.
7. Confirme que Bibliotecas, Canais, filas, OAuth, legendas, tradução e Scripted Schedules preservaram seus dados existentes.

Não há alteração de semântica em downloads, descoberta, quotas, adoção, legendas, tradução ou geração de Scripted Schedules.
