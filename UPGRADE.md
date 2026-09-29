# Atualização para 3.4.1

A versão 3.4.1 é uma correção de interface sobre a **v3.4.0**. Não altera schema, motor Universal, gerador Python nem contratos de execução do Scripted Schedule.

## O que muda

- **Ajuda** passa a ficar no grupo lateral **Programação**, imediatamente junto de Scripted Schedules, em vez de aparecer como tópico de Sistema.
- A tela deixa explícito que se trata da **Ajuda de Scripted Schedules**.
- O modal **Adicionar módulo** mostra somente os nomes na coluna esquerda.
- Descrição, funcionamento e combinações ficam no painel direito após a seleção.
- A lista foi ajustada para evitar overflow horizontal e melhorar a leitura de nomes longos.

## Compatibilidade

- `configVersion` permanece **8**.
- O schema de armazenamento de Scripted Schedules permanece **1**.
- O motor mais recente permanece **Universal v1.3.0**.
- Projetos salvos em v1.1.1/v1.2.0 continuam sem atualização silenciosa.
- `config/config.json`, `config/auth.json` e `data/` devem ser preservados durante o UPDATE.

## Atualização recomendada

1. Pare o serviço da aplicação.
2. Faça backup da instalação atual.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.1-update.zip` sobre a instalação v3.4.0.
4. Inicie novamente o serviço.
5. Abra **Programação → Scripted Schedules** e confirme que **Ajuda** aparece no mesmo grupo lateral.
6. Em um projeto, abra **Programação → Adicionar módulo** e confirme que a lista esquerda contém somente os nomes.

Não é necessária migração manual de configuração ou de projetos.

## Gate esperado

- upgrade esperado: **v3.4.0 -> v3.4.1**;
- `npm run check`: aprovado;
- suíte automatizada: aprovada;
- UPDATE não deve conter `config/config.json`, `config/auth.json` nem `data/`.
