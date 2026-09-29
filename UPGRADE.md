# Atualização para 3.4.4

A versão 3.4.4 é uma atualização de organização e comportamento do **Scripted Schedules** sobre a v3.4.3.

## O que muda

- A aba **Recursos** passa a seguir uma ordem mais fluida: **Grupos de Graphics -> Presentation Profiles -> Sources -> Scripted Playlists**.
- O **Pre-roll** do Presentation Profile fica em uma área opcional. Se a Scripted Playlist ainda não existir, ela pode ser criada depois e selecionada ao voltar ao perfil.
- Na aba **Programação**, o **Filler** aparece antes dos módulos, porque ele é uma dependência do Pad To Nearest Minute.
- O Filler geral passa a ser enviado ao ErsatzTV automaticamente como `filler_kind=postroll`, evitando uma entrada própria de Filler no EPG. O campo técnico de Filler kind deixa de aparecer na configuração do Filler geral.
- O modal **Adicionar módulo** ganha espaço entre os cards **Combina bem com** e **Pad To Nearest Minute**.
- A Ajuda acompanha a nova ordem e explica o comportamento do Filler no EPG em linguagem simples.
- A explicação contextual do Pad foi alinhada ao comportamento por item da v3.4.3.

## Compatibilidade

- `configVersion` permanece **8**.
- O schema de armazenamento de Scripted Schedules permanece **1**.
- O motor permanece **Universal v1.3.0**.
- Não existe migração de projeto. A ordem das seções é somente de interface.
- Um `fillerKind` antigo salvo no Filler geral não precisa ser removido: o gerador passa a usar `postroll` automaticamente para esse papel.
- Projetos v1.1.1/v1.2.0 continuam sem atualização silenciosa.
- `config/config.json`, `config/auth.json` e `data/` devem ser preservados durante o UPDATE.

## Atualização recomendada

1. Pare o serviço da aplicação.
2. Faça backup da instalação atual.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.4-update.zip` sobre a instalação v3.4.3.
4. Inicie novamente o serviço.
5. Abra **Programação -> Scripted Schedules** e confira Recursos/Programação.
6. Nos projetos que usam Filler, publique novamente o script para que o `filler_kind=postroll` passe a fazer parte do arquivo gerado.

Não é necessária migração manual de configuração ou de projetos.

## Gate esperado

- upgrade esperado: **v3.4.3 -> v3.4.4**;
- `npm run check`: aprovado;
- suíte automatizada: aprovada;
- UPDATE não deve conter `config/config.json`, `config/auth.json` nem `data/`.
