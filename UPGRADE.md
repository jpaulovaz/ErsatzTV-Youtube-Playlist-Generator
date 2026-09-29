# Atualização para 3.4.7

A versão 3.4.7 corrige a forma como caminhos de **Graphics Elements** são enviados ao ErsatzTV.

## O que muda

- Caminhos como `/image/watermark.yml` passam a ser normalizados como `image/watermark.yml`.
- O mesmo vale para Graphics cadastrados em grupos e diretamente em Presentation Profiles.
- Barras `\` também são normalizadas para `/`.
- A Ajuda passa a mostrar o formato esperado de forma curta.

## Compatibilidade

- Projetos existentes não precisam ser editados manualmente. Ao abrir, os caminhos já são corrigidos em memória e ficam persistidos no próximo salvamento.
- `configVersion` permanece **8**.
- O schema de armazenamento de Scripted Schedules permanece **1**.
- O motor permanece **Universal v1.3.0**.
- Pad To Nearest Minute, Filler e regras de programação não mudam.
- Projetos v1.1.1/v1.2.0 continuam sem atualização silenciosa.
- `config/config.json`, `config/auth.json` e `data/` devem ser preservados durante o UPDATE.

## Atualização recomendada

1. Pare o serviço da aplicação.
2. Faça backup da instalação atual.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.7-update.zip` sobre a instalação v3.4.6.
4. Inicie novamente o serviço.
5. Reabra o Scripted Schedule e publique o `.py` novamente.

Não é necessária migração manual de configuração ou de projetos.

## Gate esperado

- upgrade esperado: **v3.4.6 -> v3.4.7**;
- `npm run check`: aprovado;
- suíte automatizada: aprovada;
- UPDATE não deve conter `config/config.json`, `config/auth.json` nem `data/`.
