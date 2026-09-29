# Atualização para 3.4.0

A versão 3.4.0 é uma evolução funcional de **Scripted Schedules** sobre a v3.3.1. Ela adiciona novos módulos, o motor Universal v1.3.0, recorrência avançada, a área Ajuda e uma regra consistente para o menu lateral sempre retornar ao início da seção escolhida.

## O que muda

- Novos projetos de Scripted Schedule usam **Universal v1.3.0**.
- O Builder passa a oferecer **18 tipos de módulo**, incluindo Rotação por quantidade/peso, Bloco contínuo, Inserções após X itens, Encaixar até o próximo evento, Escolha entre fontes, Relógio de programação e Programação especial temporária.
- Dias/datas aceitam recorrência mensal por posição do dia da semana e repetição a cada N dias.
- **Adicionar módulo** abre um modal com descrição curta e combinação sugerida.
- Nova seção lateral **Ajuda**, com linguagem simples, exemplos e glossário.
- Clicar novamente em qualquer item do menu lateral volta à tela inicial daquela seção.
- O validador mostra aviso quando várias programações-base podem competir entre si.

## Compatibilidade de projetos Scripted Schedule

Projetos existentes **não são atualizados silenciosamente**. Um projeto salvo com Universal v1.1.1 ou v1.2.0 continua usando esse motor e pode ser publicado normalmente enquanto utilizar apenas recursos suportados por ele.

Para usar os novos módulos da v3.4.0, abra o projeto e use **Atualizar motor** na aba Geral. A alteração para v1.3.0 só é efetivada quando o projeto for salvo/publicado.

O `state_key`, Sources, Graphics, Scripted Playlists, Presentation Profiles, Filler e módulos antigos são preservados.

## Atualização

1. Pare o processo atual.
2. Faça um backup da instalação, principalmente `config/` e `data/`.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.0-update.zip` sobre a instalação v3.3.1.
4. Inicie novamente.
5. Abra **Scripted Schedules** e valide os projetos que pretende atualizar para o motor v1.3.0.

O pacote UPDATE **não inclui** `config/config.json`, `config/auth.json` nem o conteúdo de `data/`. Projetos em `data/scripted-schedules/` são preservados.

## Compatibilidade técnica

- `configVersion`: permanece **8**.
- schema do armazenamento de Scripted Schedules: permanece **1**.
- motores suportados: Universal **v1.1.1**, **v1.2.0** e **v1.3.0**.
- motor padrão para novos projetos: Universal **v1.3.0**.
- upgrade esperado: **v3.3.1 -> v3.4.0**.
- salvar/publicar continua sem executar Reset Playout automaticamente.
