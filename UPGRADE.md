# Atualização para 3.4.2

A versão 3.4.2 é uma correção de clareza sobre a **v3.4.1**. Não altera schema, motor Universal, gerador Python nem a lógica de execução do Pad To Nearest Minute.

## O que muda

- O modal **Adicionar módulo** avisa quando **Pad To Nearest Minute** não se aplica.
- A aba **Ajuda → Módulos** mostra a mesma informação em linguagem simples.
- **Bloco contínuo por horário**, **Encaixar até o próximo evento** e **Janela offline** ficam claramente marcados como módulos sem Pad.
- **Faixa de horário · rotação** informa que o Pad fica em cada etapa da rotação.
- **Relógio de programação** informa que o Pad fica em cada posição do relógio.
- **Horário fixo · todos os itens** deixa claro que o Pad funciona somente depois que todos os itens terminarem.

## Compatibilidade

- `configVersion` permanece **8**.
- O schema de armazenamento de Scripted Schedules permanece **1**.
- O motor mais recente permanece **Universal v1.3.0**.
- Projetos salvos em v1.1.1/v1.2.0 continuam sem atualização silenciosa.
- `config/config.json`, `config/auth.json` e `data/` devem ser preservados durante o UPDATE.

## Atualização recomendada

1. Pare o serviço da aplicação.
2. Faça backup da instalação atual.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.2-update.zip` sobre a instalação v3.4.1.
4. Inicie novamente o serviço.
5. Em **Programação → Scripted Schedules**, abra **Adicionar módulo** e confira as observações de Pad no painel direito.
6. Em **Programação → Ajuda → Módulos**, confira as mesmas regras em linguagem simples.

Não é necessária migração manual de configuração ou de projetos.

## Gate esperado

- upgrade esperado: **v3.4.1 -> v3.4.2**;
- `npm run check`: aprovado;
- suíte automatizada: aprovada;
- UPDATE não deve conter `config/config.json`, `config/auth.json` nem `data/`.
