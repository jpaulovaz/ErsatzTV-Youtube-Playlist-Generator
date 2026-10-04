# Atualização para 3.6.0

A versão 3.6.0 atualiza diretamente a **v3.5.3** e introduz o Gerenciador Integrado de Legendas e Player de Validação no **Ver conteúdo**.

## Versionamento

- aplicação: **v3.6.0**;
- Universal: **v1.3.1**;
- `configVersion`: **9**;
- estado persistente de downloads: **5**;
- schema de Scripted Schedules: **1**;
- novo estado do Gerenciador de Legendas: **1**.

Não existe migração de `config.json`, `download-state.json` nem de projetos de Scripted Schedules nesta versão.

## Antes de atualizar

1. Confirme que a instalação atual está em **v3.5.3** e inicia normalmente.
2. Faça backup de `config/` e `data/`.
3. Preserve as pastas de mídia normalmente; o update não as contém nem as modifica durante a instalação.
4. Confirme que `yt-dlp`, `ffmpeg` e `ffprobe` continuam acessíveis nos caminhos configurados.
5. Para usar o provider LRCLIB, permita saída HTTPS do servidor para `https://lrclib.net`.

## Aplicando o pacote update

Pare o serviço e extraia `ErsatzTV-YouTube-Downloader-v3.6.0-update.zip` sobre a instalação v3.5.3:

```bash
sudo systemctl stop ersatztv-youtube-downloader
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.6.0-update.zip -d /caminho/da/aplicacao
cd /caminho/da/aplicacao
npm run verify
sudo systemctl start ersatztv-youtube-downloader
```

O update **não contém** `config/config.json`, `config/auth.json`, `data/` nem mídia do usuário.

Depois do primeiro acesso, use `Ctrl+F5` se o navegador ainda exibir arquivos estáticos antigos.

## O que muda para as legendas

O download automático de legendas do YouTube configurado em cada Biblioteca continua funcionando como antes. O novo gerenciador é uma ferramenta manual adicional.

No **Ver conteúdo**:

- **Gerenciar legendas** consulta faixas do YouTube e, em Clipes musicais, resultados do LRCLIB;
- SRTs já existentes podem ser testados no player, inclusive os baixados por versões anteriores;
- preview, busca e offset temporário não sobrescrevem a legenda ativa;
- **Aplicar** e **Salvar ajuste** guardam a versão anterior no histórico antes de escrever;
- até cinco versões anteriores por idioma ficam em `data/subtitle-history/`;
- `data/subtitle-manager-state.json` é criado automaticamente quando necessário;
- prévias compatíveis geradas por ffmpeg ficam em `data/.subtitle-preview/` e são temporárias.

Para arquivos existentes cuja origem nunca foi registrada, a interface usa **Arquivo local · origem não registrada**. Isso não impede preview, offset, substituição ou restauração.

## Validação após o update

1. Abra uma Biblioteca em **Ver conteúdo** e selecione um vídeo com SRT existente.
2. Confirme que **Testar no player** mostra a legenda sem modificar o arquivo.
3. Consulte as faixas do YouTube e confirme que manuais e automáticas aparecem separadamente quando disponíveis.
4. Em um destino **Clipes musicais**, faça uma busca LRCLIB e teste um candidato sincronizado antes de aplicar.
5. Se usar offset, confirme que o preview muda imediatamente e que o arquivo só é regravado após **Salvar ajuste**.
6. Aplique uma faixa e confirme que a versão anterior aparece no histórico com opção **Restaurar**.

## Rollback

A v3.6.0 não altera os formatos de configuração, download state ou Scripted Schedules. Para rollback, pare o serviço e restaure os arquivos da v3.5.3 mantendo `config/`, `data/` e as mídias.

Os SRT aplicados ou ajustados manualmente continuam sendo arquivos SRT normais. Se desejar desfazer alterações de legenda antes do rollback, use o próprio histórico do Gerenciador enquanto ainda estiver na v3.6.0.
