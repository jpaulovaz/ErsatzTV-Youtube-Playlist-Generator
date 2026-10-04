# Atualização para 3.6.2

A versão 3.6.2 atualiza diretamente a **v3.6.1** e melhora a identificação visual da legenda que está sendo testada no player do **Ver conteúdo**.

## Versionamento

- aplicação: **v3.6.2**;
- Universal: **v1.3.1**;
- `configVersion`: **9**;
- estado persistente de downloads: **5**;
- schema de Scripted Schedules: **1**;
- estado do Gerenciador de Legendas: **1**.

Não existe migração de configuração, estado ou projetos de Scripted Schedules.

## Antes de atualizar

1. Confirme que a instalação atual está em **v3.6.1** e inicia normalmente.
2. Faça backup de `config/` e `data/`.
3. Preserve normalmente as pastas de mídia; o pacote update não contém mídia.

## Aplicando o pacote update

Pare o serviço e extraia `ErsatzTV-YouTube-Downloader-v3.6.2-update.zip` sobre a instalação v3.6.1:

```bash
sudo systemctl stop ersatztv-youtube-downloader
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.6.2-update.zip -d /caminho/da/aplicacao
cd /caminho/da/aplicacao
npm run verify
sudo systemctl start ersatztv-youtube-downloader
```

O update **não contém** `config/config.json`, `config/auth.json`, `data/` nem mídia do usuário.

Depois do primeiro acesso, use `Ctrl+F5` se o navegador ainda exibir arquivos estáticos antigos.

## O que muda no Gerenciador de Legendas

- A faixa local atualmente carregada no player recebe destaque visual.
- Um resultado de YouTube ou LRCLIB atualmente carregado em prévia recebe o mesmo destaque.
- O botão correspondente muda de **Testar no player** para **Em teste no player** enquanto aquela faixa estiver selecionada.
- Ao testar outra legenda, o destaque anterior é removido e a nova seleção é marcada imediatamente.
- A troca de destaque entre resultados não força recarga da página nem reinicialização do player.

## Validação após o update

1. Abra **Ver conteúdo > Gerenciar legendas** em um item com pelo menos duas opções de legenda.
2. Clique em **Testar no player** numa legenda local e confirme que a linha e o botão ficam destacados e o texto muda para **Em teste no player**.
3. Teste outra legenda local e confirme que o destaque migra para ela.
4. Faça uma pesquisa no YouTube ou LRCLIB, teste um resultado e confirme o mesmo comportamento na lista de candidatos.
5. Alterne entre dois candidatos e confirme que somente o candidato atual permanece destacado.

## Rollback

A v3.6.2 não altera formatos persistentes. Para rollback, pare o serviço e restaure os arquivos da v3.6.1 mantendo `config/`, `data/` e as mídias.
