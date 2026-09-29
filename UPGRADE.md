# Atualização para 3.4.6

A versão 3.4.6 é uma limpeza de interface do **Scripted Schedules** sobre a v3.4.5.

## O que muda

- O perfil interno **Nenhum / none** não aparece mais dentro de Presentation Profiles.
- **Nenhum** continua disponível nos seletores quando você quiser usar o conteúdo sem Presentation Profile.
- O perfil interno é criado automaticamente pelo gerador e permanece sempre vazio.
- Novos projetos passam a guardar somente os Presentation Profiles realmente criados pelo usuário.
- Projetos antigos com o `none` padrão são ajustados automaticamente ao carregar.
- Se um projeto antigo tiver conteúdo configurado dentro de `none`, esse conteúdo é preservado em um perfil visível chamado **Perfil antigo** em vez de ser apagado.

## Compatibilidade

- `configVersion` permanece **8**.
- O schema de armazenamento de Scripted Schedules permanece **1**.
- O motor permanece **Universal v1.3.0**.
- Pad To Nearest Minute, Filler e regras de programação não mudam.
- Projetos v1.1.1/v1.2.0 continuam sem atualização silenciosa.
- `config/config.json`, `config/auth.json` e `data/` devem ser preservados durante o UPDATE.

## Atualização recomendada

1. Pare o serviço da aplicação.
2. Faça backup da instalação atual.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.6-update.zip` sobre a instalação v3.4.5.
4. Inicie novamente o serviço.
5. Abra **Programação -> Scripted Schedules -> Recursos** e confira Presentation Profiles.

Não é necessária migração manual de configuração ou de projetos.

## Gate esperado

- upgrade esperado: **v3.4.5 -> v3.4.6**;
- `npm run check`: aprovado;
- suíte automatizada: aprovada;
- UPDATE não deve conter `config/config.json`, `config/auth.json` nem `data/`.
