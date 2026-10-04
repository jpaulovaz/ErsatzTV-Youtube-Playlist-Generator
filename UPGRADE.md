# Atualização para 3.6.1

A versão 3.6.1 atualiza diretamente a **v3.6.0** e refina o Gerenciador de Legendas e o player integrado ao **Ver conteúdo**.

## Versionamento

- aplicação: **v3.6.1**;
- Universal: **v1.3.1**;
- `configVersion`: **9**;
- estado persistente de downloads: **5**;
- schema de Scripted Schedules: **1**;
- estado do Gerenciador de Legendas: **1**.

Não existe migração de `config.json`, `download-state.json`, `subtitle-manager-state.json` nem de projetos de Scripted Schedules.

## Antes de atualizar

1. Confirme que a instalação atual está em **v3.6.0** e inicia normalmente.
2. Faça backup de `config/` e `data/`.
3. Preserve normalmente as pastas de mídia; o pacote update não contém mídia.

## Aplicando o pacote update

Pare o serviço e extraia `ErsatzTV-YouTube-Downloader-v3.6.1-update.zip` sobre a instalação v3.6.0:

```bash
sudo systemctl stop ersatztv-youtube-downloader
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.6.1-update.zip -d /caminho/da/aplicacao
cd /caminho/da/aplicacao
npm run verify
sudo systemctl start ersatztv-youtube-downloader
```

O update **não contém** `config/config.json`, `config/auth.json`, `data/` nem mídia do usuário.

Depois do primeiro acesso, use `Ctrl+F5` se o navegador ainda exibir arquivos estáticos antigos.

## O que muda no Gerenciador de Legendas

- **Idioma desejado** passa a ser um seletor com somente Português (Brasil), English e Español.
- A consulta do YouTube mostra somente faixas compatíveis com o idioma selecionado.
- Aplicações do LRCLIB também usam explicitamente o idioma selecionado; novos arquivos não são gravados como `.und.srt`.
- **Excluir legenda** remove o SRT ativo após confirmação e preserva uma cópia no histórico para restauração.
- Fechar o gerenciador ou os detalhes do conteúdo interrompe e descarrega o player.
- O layout de Ver conteúdo, player, busca, resultados e offset foi ajustado para telas móveis.

As legendas existentes com outros códigos de idioma continuam sendo reconhecidas, reproduzidas e podem ser excluídas/restauradas. O seletor fechado vale apenas para novas aplicações manuais do gerenciador.

## Validação após o update

1. Abra **Ver conteúdo > Gerenciar legendas**.
2. Confirme que o idioma desejado oferece apenas `pt-BR`, `en` e `es`.
3. Pesquise no YouTube e confirme que os resultados respeitam o idioma selecionado.
4. Em um Clipe musical, aplique uma faixa LRCLIB como English e confirme a criação de `.en.srt`, não `.und.srt`.
5. Exclua uma legenda local, confirme que o SRT ativo some e que a versão removida pode ser restaurada pelo histórico.
6. Inicie a reprodução e feche o gerenciador; o áudio/vídeo deve parar imediatamente.
7. Em um celular ou viewport estreito, confirme que ações, player e controles não exigem rolagem horizontal.

## Rollback

A v3.6.1 não altera formatos persistentes. Para rollback, pare o serviço e restaure os arquivos da v3.6.0 mantendo `config/`, `data/` e as mídias.
