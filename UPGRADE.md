# Atualização para 3.4.5

A versão 3.4.5 é uma atualização de interface e clareza do **Scripted Schedules** sobre a v3.4.4.

## O que muda

- O **Filler geral** volta a mostrar **Tipo de Filler**, agora como um seletor simples com Post-roll, Pre-roll, Mid-roll e Nenhum.
- **Post-roll** continua sendo o padrão e aparece como recomendado para preencher lacunas e para o Pad.
- Projetos antigos que não possuem `fillerKind` salvo continuam sendo tratados como Post-roll.
- O campo deixa de aceitar texto livre; somente valores suportados podem ser escolhidos.
- Foram removidos textos redundantes da pasta de saída, do Filler e da área de Programação.
- As orientações de vínculo/publicação com o Playout foram reescritas de forma mais natural.
- A Ajuda de **Variáveis dos Graphics** agora explica que as chaves são definidas pelo YAML/Scriban e mostra exemplos de dados que o ErsatzTV já fornece diretamente ao Graphics.

## Compatibilidade

- `configVersion` permanece **8**.
- O schema de armazenamento de Scripted Schedules permanece **1**.
- O motor permanece **Universal v1.3.0**.
- O comportamento do **Pad To Nearest Minute por item** não muda.
- Não existe migração obrigatória de projeto.
- Um Filler geral antigo sem `fillerKind` continua sendo gerado como Post-roll.
- Projetos v1.1.1/v1.2.0 continuam sem atualização silenciosa.
- `config/config.json`, `config/auth.json` e `data/` devem ser preservados durante o UPDATE.

## Atualização recomendada

1. Pare o serviço da aplicação.
2. Faça backup da instalação atual.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.5-update.zip` sobre a instalação v3.4.4.
4. Inicie novamente o serviço.
5. Abra **Programação -> Scripted Schedules** e confira o Filler e a Ajuda.
6. Só republique um projeto se quiser mudar o Tipo de Filler que já estava sendo tratado como Post-roll.

Não é necessária migração manual de configuração ou de projetos.

## Gate esperado

- upgrade esperado: **v3.4.4 -> v3.4.5**;
- `npm run check`: aprovado;
- suíte automatizada: aprovada;
- UPDATE não deve conter `config/config.json`, `config/auth.json` nem `data/`.
