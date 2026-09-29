# Atualização para 3.3.1

A versão 3.3.1 é uma atualização de interface sobre a v3.3.0. Ela adiciona ajuda contextual aos campos da área **Scripted Schedules** e não altera a lógica do motor Universal v1.2.0.

## O que muda

- Pequeno ícone `?` ao lado dos campos de configuração de Scripted Schedules.
- Explicações curtas em linguagem simples ao passar o mouse, focar pelo teclado ou tocar no ícone.
- Exemplos práticos em opções que costumam gerar dúvida, como Fallback Source e Pad To Nearest Minute.
- Campos técnicos de Reprodução avançada passam a explicar claramente seu efeito.
- Controles em linha de GUIDs, Scripted Playlists, Window Rotations, Sequences e variáveis de Graphics ganham rótulos e ajuda.

## Atualização

Pare o processo, extraia `ErsatzTV-YouTube-Downloader-v3.3.1-update.zip` sobre uma instalação v3.3.0 e inicie novamente.

O pacote UPDATE não inclui `config/config.json`, `config/auth.json` nem `data/`. Projetos existentes em `data/scripted-schedules/` são preservados.

## Compatibilidade

- `configVersion`: permanece 8.
- schema do módulo Scripted Schedules: permanece 1.
- motores suportados: Universal v1.1.1 e v1.2.0.
- motor padrão para novos projetos: Universal v1.2.0.
- upgrade esperado: v3.3.0 -> v3.3.1.
