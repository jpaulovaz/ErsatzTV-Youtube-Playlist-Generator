# Atualização para 3.6.4

A versão 3.6.4 atualiza diretamente a **v3.6.3** e corrige a descoberta automática de legendas do YouTube quando a faixa usa um identificador específico, como `en-eEY6OEpapPo`. Também renomeia **Ver conteúdo** para **Gerenciar conteúdo**.

## Versionamento

- aplicação: **v3.6.4**;
- Universal: **v1.3.1**;
- `configVersion`: **9**;
- estado persistente de downloads: **5**;
- schema de Scripted Schedules: **1**;
- estado do Gerenciador de Legendas: **1**.

Não existe migração de configuração ou estado.

## Antes de atualizar

1. Confirme que a instalação atual está em **v3.6.3**.
2. Faça backup de `config/` e `data/`.
3. Pare o serviço antes de substituir os arquivos.

## Aplicando o update

```bash
sudo systemctl stop ersatztv-youtube-downloader
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.6.4-update.zip -d /caminho/da/aplicacao
cd /caminho/da/aplicacao
npm run verify
sudo systemctl start ersatztv-youtube-downloader
```

O update não contém `config/config.json`, `config/auth.json`, `data/` nem mídia.

## O que muda nas legendas automáticas

O fluxo anterior enviava ao yt-dlp apenas os códigos configurados literalmente, por exemplo `en`. O YouTube pode publicar uma faixa manual com um identificador mais específico, como `en-eEY6OEpapPo`; por isso a nova busca manual conseguia encontrá-la enquanto o fluxo automático podia ignorá-la.

A v3.6.4 primeiro consulta as faixas realmente disponíveis. Para cada idioma configurado, escolhe uma faixa compatível, com preferência por **enviada pelo canal** e fallback para **automática** quando `Incluir automáticas` estiver habilitado. O arquivo final continua usando o código canônico configurado, por exemplo `.en.srt`.

A correção vale tanto para legendas procuradas após novos downloads quanto para **Buscar legendas ausentes**.

## Gerenciar conteúdo

O botão e o nome corrente da área passam de **Ver conteúdo** para **Gerenciar conteúdo**, refletindo que a tela agora permite filtrar, testar, aplicar, remover e restaurar legendas, além das ações de gerenciamento do acervo.

## Validação após o update

1. Abra uma biblioteca com legendas habilitadas.
2. Use **Buscar legendas ausentes** em um vídeo que possua uma faixa manual com tag específica no YouTube.
3. Confirme que a legenda é gravada com o idioma configurado, por exemplo `.en.srt`.
4. Abra **Gerenciar conteúdo** e confirme a origem da faixa no Gerenciador de Legendas.

## Rollback

A v3.6.4 não altera formatos persistentes. Para rollback, restaure os arquivos da v3.6.3 preservando `config/`, `data/` e as mídias.
