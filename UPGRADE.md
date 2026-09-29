# Atualização para 3.4.9

A versão 3.4.9 adiciona o motor **Universal v1.3.1** para tratar melhor eventos com horário marcado.

## O que muda

- Eventos compatíveis ganham a opção **Se o conteúdo passar do horário**.
- **Usar o horário mais próximo** consulta a duração do próximo item antes de iniciá-lo e compara o adiantamento possível com o atraso que esse item causaria.
- **Pode adiantar até (min)** vem preenchido com **40** e pode ser alterado pelo usuário.
- **Esperar o conteúdo terminar** mantém o comportamento em que o item atual pode ultrapassar o horário antes do evento começar.
- Quando o próximo item ainda cabe antes do evento, o motor toca somente esse item e reavalia a programação depois, em vez de entregar um bloco longo ao ErsatzTV.
- O cálculo considera um pre-roll quando a Scripted Playlist pode ser estimada com segurança.
- **Trim** e **Deixar o vídeo terminar** deixam de poder ficar ativos ao mesmo tempo. Trim força `allow_overrun=false` também no Python gerado.
- O Pad To Nearest, quando é interrompido por um evento marcado, não recebe permissão para ultrapassar essa fronteira.

## Motor

- Novos projetos usam **Universal v1.3.1**.
- Projetos salvos em v1.1.1, v1.2.0 ou v1.3.0 não são atualizados silenciosamente.
- Para usar a política de horário mais próximo em um projeto existente, abra-o e use **Atualizar motor**; depois revise, valide e publique novamente o `.py`.
- `STATE_VERSION` do motor v1.3.1 passa para **12**, reiniciando somente o estado interno do script quando necessário. A configuração visual do projeto não é apagada.

## Compatibilidade técnica

- `configVersion` permanece **8**.
- O schema de armazenamento de Scripted Schedules permanece **1**.
- Universal v1.1.1, v1.2.0 e v1.3.0 continuam disponíveis sem alteração.
- A arquitetura de ordem por uso da v3.4.8 permanece: Chronological/Shuffle continuam definidos na Programação, Filler, Scripted Playlists e Fallbacks.
- Graphics, Presentation Profiles, Canais, Bibliotecas e downloads não mudam nesta versão.
- `config/config.json`, `config/auth.json` e `data/` devem ser preservados durante o UPDATE.

## Atualização recomendada

1. Pare o serviço da aplicação.
2. Faça backup da instalação atual.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.9-update.zip` sobre a instalação v3.4.8.
4. Inicie novamente o serviço e faça um recarregamento completo do navegador.
5. Nos projetos em que quiser o novo comportamento, atualize o motor para **1.3.1**.
6. Revise **Se o conteúdo passar do horário** e o limite de adiantamento.
7. Valide e publique novamente os `.py`.

## Gate esperado

- upgrade esperado: **v3.4.8 -> v3.4.9**;
- `npm run check`: aprovado;
- suíte automatizada: aprovada;
- UPDATE não deve conter `config/config.json`, `config/auth.json` nem `data/`.
