# Atualização para 3.4.12

A versão 3.4.12 ajusta somente a identidade de publicação dos **Scripted Schedules**. O Universal permanece v1.3.1 e o módulo de downloads não recebe alteração funcional nesta versão.

## O que muda

- Projetos novos não recebem mais um nome de `.py` definitivo enquanto ainda são rascunhos.
- Ao duplicar uma configuração, o novo projeto copia Recursos, Programação e opções, mas começa sem arquivo publicado e sem vínculo com o canal original.
- Renomeie a cópia e escolha o novo canal normalmente. Na primeira publicação, o nome atual gera automaticamente o arquivo `.py` e o `state_key`.
- Depois da primeira publicação, essas duas identidades permanecem estáveis para não quebrar o Playout já configurado.
- Rascunhos antigos ainda não publicados deixam de usar nomes provisórios como `-copia`; a identidade definitiva será criada quando forem publicados pela primeira vez.

## Exemplo

Uma configuração duplicada de `415 - JOHNFLIX MUSIC` pode inicialmente aparecer como `415 - JOHNFLIX MUSIC - Copia`. Antes de publicar, renomeie para o novo canal e selecione o canal correspondente. Se o nome final for `420 - JOHNFLIX MUSIC`, a primeira publicação criará `420-johnflix-music.py` e um `state_key` baseado em `420_johnflix_music` + número do canal.

## Interface

Enquanto o projeto ainda não foi publicado, a tela informa de forma curta que o arquivo e o identificador do canal serão criados na primeira publicação. O caminho final e o `state_key` aparecem normalmente depois que o arquivo existe.

## Compatibilidade técnica

- aplicação: **v3.4.12**;
- Universal permanece **v1.3.1**;
- `configVersion` permanece **8**;
- schema de Scripted Schedules permanece **1**;
- estado da fila permanece **4**;
- templates Universal não mudam;
- o botão temporário **Atualizar datas e episódios** permanece disponível enquanto a homologação da migração de mídia não for encerrada;
- `config/config.json`, `config/auth.json` e `data/` devem ser preservados durante o UPDATE.

## Atualização recomendada

1. Pare o serviço da aplicação.
2. Faça backup da instalação atual.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.12-update.zip` sobre a instalação v3.4.11.
4. Inicie novamente o serviço e faça um recarregamento completo do navegador.
5. Para projetos já publicados, nada precisa ser recriado: arquivo e `state_key` atuais continuam os mesmos.
6. Para uma cópia ainda não publicada, renomeie, escolha o novo canal e publique; o arquivo/state serão criados usando esses dados.

## Gate esperado

- upgrade esperado: **v3.4.11 -> v3.4.12**;
- `npm run check`: aprovado;
- suíte automatizada: aprovada;
- UPDATE não deve conter `config/config.json`, `config/auth.json` nem `data/`.
