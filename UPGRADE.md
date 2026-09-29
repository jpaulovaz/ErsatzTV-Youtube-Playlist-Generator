# Atualização para 3.4.8

A versão 3.4.8 muda onde a **ordem de reprodução** é configurada nos Scripted Schedules.

## O que muda

- O cadastro da Source deixa de ter a opção genérica de ordem.
- A ordem passa a ser escolhida onde a Source é usada: módulos, Filler, Scripted Playlists e Fallbacks.
- Os modos disponíveis continuam sendo **Chronological** e **Shuffle**, que são os modos aceitos pela API de Scripted Schedule para esses tipos de Source.
- A mesma Source pode ser Chronological em um bloco e Shuffle em outro.
- O gerador cria internamente variantes separadas para o ErsatzTV quando as duas ordens forem necessárias.
- Marathon mantém suas próprias opções de ordem e agrupamento.

## Homologação / configuração existente

Esta mudança prioriza a arquitetura nova e não mantém o antigo `source.order` como fallback. Ao carregar um projeto antigo, esse campo é descartado. Um uso da Source que ainda não tenha uma ordem própria recebe **Shuffle** como padrão.

Como o ambiente atual é de homologação, revise a ordem desejada em cada bloco antes de publicar novamente o `.py`. Não é necessário editar o Python manualmente.

## Compatibilidade técnica

- `configVersion` permanece **8**.
- O schema de armazenamento de Scripted Schedules permanece **1**.
- O motor permanece **Universal v1.3.0**.
- Templates v1.1.1/v1.2.0 continuam sem atualização silenciosa.
- Graphics, Presentation Profiles, Pad To Nearest Minute, Filler, Canais, Bibliotecas e downloads não mudam nesta versão.
- `config/config.json`, `config/auth.json` e `data/` devem ser preservados durante o UPDATE.

## Atualização recomendada

1. Pare o serviço da aplicação.
2. Faça backup da instalação atual.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.8-update.zip` sobre a instalação v3.4.7.
4. Inicie novamente o serviço e faça um recarregamento completo do navegador.
5. Revise a ordem de reprodução em cada uso das Sources.
6. Valide e publique novamente os `.py`.

## Gate esperado

- upgrade esperado: **v3.4.7 -> v3.4.8**;
- `npm run check`: aprovado;
- suíte automatizada: aprovada;
- UPDATE não deve conter `config/config.json`, `config/auth.json` nem `data/`.
