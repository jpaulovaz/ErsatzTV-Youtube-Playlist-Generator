# Atualização para 3.4.3

A versão 3.4.3 corrige o comportamento de **Pad To Nearest Minute** sobre a v3.4.2.

## O que muda

- Nos módulos compatíveis, o Pad passa a entrar **depois de cada item**.
- Exemplo com 3 filmes: filme -> Filler até a próxima marca -> filme -> Filler -> filme -> Filler.
- O Pad não passa por cima de um horário programado: se outro evento começa antes da próxima marca, o Filler para nesse horário. As regras normais de prioridade continuam iguais.
- O campo de Pad deixa de aparecer em operações que o ErsatzTV executa como um bloco inteiro: Duração, Todos os itens e faixas de duração.
- Em módulos com modo variável, Pad aparece quando o modo é **Quantidade**.
- Em Sequência, Pad fica disponível quando os passos de conteúdo não usam **Duração** nem **Todos os itens**.
- O modal de módulos e a Ajuda mostram essas regras de forma curta.

## Compatibilidade

- `configVersion` permanece **8**.
- O schema de armazenamento de Scripted Schedules permanece **1**.
- O motor permanece **Universal v1.3.0**, com correção de comportamento do Pad.
- Projetos v1.1.1/v1.2.0 continuam sem atualização silenciosa.
- Em projetos Universal v1.3.0, campos antigos de Pad salvos em módulos que não suportam alinhamento por item são ignorados pelo gerador. Projetos v1.1.1/v1.2.0 continuam no motor já salvo e preservam seu comportamento histórico.
- `config/config.json`, `config/auth.json` e `data/` devem ser preservados durante o UPDATE.

## Atualização recomendada

1. Pare o serviço da aplicação.
2. Faça backup da instalação atual.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.3-update.zip` sobre a instalação v3.4.2.
4. Inicie novamente o serviço.
5. Abra **Programação -> Scripted Schedules** e valide/publice os projetos que usam Pad.
6. Confira **Programação -> Ajuda -> Módulos** para ver onde Pad está disponível.

Não é necessária migração manual de configuração ou de projetos.

## Gate esperado

- upgrade esperado: **v3.4.2 -> v3.4.3**;
- `npm run check`: aprovado;
- suíte automatizada: aprovada;
- UPDATE não deve conter `config/config.json`, `config/auth.json` nem `data/`.
