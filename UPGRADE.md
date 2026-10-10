# Atualização para 3.9.7

A versão 3.9.7 é uma atualização incremental sobre a **v3.9.6**, focada exclusivamente na consistência visual do **Gerenciador do YouTube**. Não há migração de configuração, estado ou schema.

## Versionamento

- aplicação: **v3.9.7**;
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

Pare o serviço, faça backup da instalação e extraia o pacote incremental sobre a instalação v3.9.6:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.9.6-to-v3.9.7-update.zip -d /caminho/da/aplicacao
```

Depois reinicie o serviço. O pacote não substitui `config/config.json`, `config/auth.json`, `config/youtube-account.json`, `data/` nem arquivos de mídia.

## Ajuste visual

O Gerenciador do YouTube passa a aplicar uma única regra estrutural de espaçamento entre cards visíveis em todas as abas. Isso corrige especificamente:

- **Minhas playlists** e **Fila de inserção** encostadas;
- painel de **Correspondência**, painel de **Adoção** e **Fila de adoção** com espaçamento dependente de regra específica da aba;
- futuras combinações de cards dentro de Pesquisa, Acervo local, Minhas playlists e Conta.

A regra anterior tratava apenas a aba **Acervo local**. A v3.9.7 usa o mesmo `gap` de 1rem para qualquer card irmão visível do Gerenciador do YouTube, evitando correções pontuais divergentes.

## Validação após atualizar

1. Abra **YouTube -> Gerenciador do YouTube -> Minhas playlists** e confirme o espaço entre **Minhas playlists** e **Fila de inserção**.
2. Abra **Acervo local** e, quando exibidos, confira **Correspondência**, **Adoção** e **Fila de adoção**.
3. Verifique que os espaçamentos permanecem equivalentes em desktop e em layout responsivo.

Nenhuma fila, match, playlist, conta OAuth ou estado de adoção é alterado por esta atualização.
