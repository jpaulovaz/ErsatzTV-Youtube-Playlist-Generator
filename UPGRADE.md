# Atualização para 3.6.3

A versão 3.6.3 atualiza diretamente a **v3.6.2** e adiciona filtros de legenda ao **Ver conteúdo**, sem alterar formatos persistentes.

## Versionamento

- aplicação: **v3.6.3**;
- Universal: **v1.3.1**;
- `configVersion`: **9**;
- estado persistente de downloads: **5**;
- schema de Scripted Schedules: **1**;
- estado do Gerenciador de Legendas: **1**.

Não existe migração de configuração, estado ou projetos de Scripted Schedules.

## Antes de atualizar

1. Confirme que a instalação atual está em **v3.6.2** e inicia normalmente.
2. Faça backup de `config/` e `data/`.
3. Preserve normalmente as pastas de mídia; o pacote update não contém mídia.

## Aplicando o pacote update

Pare o serviço e extraia `ErsatzTV-YouTube-Downloader-v3.6.3-update.zip` sobre a instalação v3.6.2:

```bash
sudo systemctl stop ersatztv-youtube-downloader
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.6.3-update.zip -d /caminho/da/aplicacao
cd /caminho/da/aplicacao
npm run verify
sudo systemctl start ersatztv-youtube-downloader
```

O update **não contém** `config/config.json`, `config/auth.json`, `data/` nem mídia do usuário.

Depois do primeiro acesso, use `Ctrl+F5` se o navegador ainda exibir arquivos estáticos antigos.

## O que muda em Ver conteúdo

- **Exibir > Sem legendas** lista somente vídeos ativos sem faixa de legenda registrada.
- **Exibir > Com legendas** lista somente vídeos que possuem ao menos uma faixa.
- Em **Com legendas**, surge ao lado **Origem da legenda** com:
  - Todas as origens;
  - YouTube;
  - LRCLIB;
  - Arquivo local / origem não registrada.
- Um vídeo com, por exemplo, uma faixa do YouTube e outra do LRCLIB aparece nos dois filtros correspondentes.
- Legendas antigas sem proveniência salva são tratadas como **Arquivo local / origem não registrada**; a aplicação não tenta adivinhar sua fonte.

## Validação após o update

1. Abra **Ver conteúdo** de uma Biblioteca ou Playlist de Canal.
2. Em **Exibir**, escolha **Sem legendas** e confirme que aparecem somente vídeos sem faixas registradas.
3. Escolha **Com legendas** e confirme que o seletor **Origem da legenda** aparece ao lado.
4. Teste **YouTube**, **LRCLIB** e **Arquivo local / origem não registrada** conforme existirem no acervo.
5. Confirme que a pesquisa por título/artista continua funcionando dentro da visão selecionada.

## Rollback

A v3.6.3 não altera formatos persistentes. Para rollback, pare o serviço e restaure os arquivos da v3.6.2 mantendo `config/`, `data/` e as mídias.
