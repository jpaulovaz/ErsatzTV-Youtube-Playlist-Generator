# Atualização para 3.2.1

A versão 3.2.1 é uma atualização de interface sobre a v3.2.0. Não altera schemas, APIs do módulo Scripted Schedules nem o motor Universal v1.1.1.

## O que muda

- Recursos são exibidos em sanfonas por categoria e por item.
- Programação usa sanfonas para opções globais, módulos, itens e Filler.
- O estado aberto/fechado é preservado durante os rerenders da tela.
- Novos itens abrem automaticamente para edição.
- Recursos e Programação agora possuem **Validar** e **Salvar e publicar** também no final da tela.

## Atualização

Pare o processo, extraia `ErsatzTV-YouTube-Downloader-v3.2.1-update.zip` sobre uma instalação v3.2.0 e inicie novamente.

O pacote UPDATE não inclui `config/config.json`, `config/auth.json` nem `data/`. Seus projetos em `data/scripted-schedules/` são preservados.

Depois da atualização, abra um projeto em **Scripted Schedules** e confira as abas **Recursos** e **Programação**. Não é necessário republicar scripts existentes apenas por causa desta atualização.

## Compatibilidade

- `configVersion`: permanece 8.
- schema do módulo Scripted Schedules: permanece 1.
- template do gerador: permanece Universal v1.1.1.
- upgrade esperado: v3.2.0 -> v3.2.1.
