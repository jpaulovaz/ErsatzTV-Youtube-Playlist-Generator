# Atualização para 3.7.0

A versão 3.7.0 atualiza diretamente a **v3.6.4** e adiciona tradução em massa de legendas locais com Gemini. O recurso é opcional e não altera o comportamento de download quando não é configurado.

## Versionamento

- aplicação: **v3.7.0**;
- Universal: **v1.3.1**;
- `configVersion`: **9**;
- download state: **5**;
- Scripted Schedules schema: **1**;
- subtitle-manager state: **1**;
- subtitle-translation config: **1** (novo);
- subtitle-translation state: **1** (novo).

Não existe migração do `config.json` nem do download state. Os novos arquivos de tradução são criados somente quando o recurso é utilizado.

## Antes de atualizar

1. Confirme que a instalação atual está em **v3.6.4**.
2. Faça backup de `config/`, `data/` e das mídias/sidecars `.srt`.
3. Deixe downloads e manutenção de legendas terminarem.
4. Pare o serviço antes de substituir os arquivos.

## Aplicando o update

```bash
sudo systemctl stop ersatztv-youtube-downloader
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.7.0-update.zip -d /caminho/da/aplicacao
cd /caminho/da/aplicacao
npm run verify
sudo systemctl start ersatztv-youtube-downloader
```

O update não contém `config/config.json`, `config/auth.json`, `config/subtitle-translation.json`, `data/` nem mídia.

## Configurando o Gemini

A forma preferencial é definir a chave no ambiente do serviço:

```bash
GEMINI_API_KEY=SUA_CHAVE
```

Também é possível informar a chave em **Configurações -> Tradução de legendas**. Nesse caso ela é gravada em `config/subtitle-translation.json` (versão 1), separado do `config.json`, com permissões restritas. O navegador recebe somente o status Configurada/Não configurada.

Depois de configurar:

1. use **Atualizar modelos**;
2. escolha um modelo compatível com `generateContent`;
3. use **Testar conexão**;
4. mantenha concorrência 1 inicialmente, principalmente em contas com quota reduzida.

## Traduzindo em massa

Abra **Gerenciar conteúdo -> Traduzir legendas**.

1. Escolha uma legenda-fonte existente, por exemplo **English (`en`)**.
2. Escolha o idioma de destino.
3. Escolha **Somente traduzida** ou **Bilíngue**.
4. Escolha o escopo atual filtrado ou todo o destino.
5. Para destino existente, prefira **Ignorar** na primeira execução.
6. Clique em **Pré-analisar** e confira as contagens.
7. Inicie a tradução somente depois de revisar elegíveis e estimativa de tokens.

A legenda-fonte nunca é modificada. A tradução só é publicada quando a timeline final é idêntica à fonte. Em caso de substituição, a versão anterior entra no histórico do Gerenciador de Legendas.

A fila pode ser pausada/retomada e sobrevive a restart por meio de `data/subtitle-translation-state.json` e checkpoints em `data/subtitle-translation-jobs/`. Cancelar afeta somente trabalho ainda não concluído.

## Limpeza e redownload das legendas antigas

Se você apagar SRTs antigos e usar **Buscar legendas ausentes** antes de traduzir, a v3.7.0 atualiza a metadata de procedência quando a nova faixa é recriada. Assim uma antiga faixa automática pode passar corretamente a **YouTube - enviada pelo canal** quando essa for a nova origem.

## Privacidade

O texto dos cues selecionados é enviado ao Google Gemini. A aplicação não envia timestamps ao modelo e não registra a letra/prompt completo nem a API key no `app.log`. A chave é enviada à API por `x-goog-api-key`.

## Validação após o update

1. Execute `npm run verify`.
2. Abra **Configurações -> Tradução de legendas** e teste a conexão, se for usar Gemini.
3. Em uma biblioteca pequena, faça uma pré-análise `en -> pt-BR`.
4. Traduza um item em **Somente traduzida** e confirme que o `.en.srt` permanece intacto.
5. Teste a nova `.pt-BR.srt` no player e confirme a origem **Gemini**.
6. Teste o modo bilíngue em outro item e confira original acima/tradução abaixo.

## Rollback

A v3.7.0 não muda os formatos principais existentes. Para rollback do aplicativo, restaure os arquivos da v3.6.4 preservando `config/`, `data/` e as mídias. Traduções `.srt` já concluídas são sidecars normais e não são removidas automaticamente pelo rollback.
