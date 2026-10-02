# Atualização para 3.4.17

A versão 3.4.17 corrige a integração entre **Título customizado** e o EPG dos Scripted Schedules. O campo continua podendo apenas renomear cada entrada individual, mas agora possui a opção **Agrupar itens no EPG usando este título**. Quando ligada, o aplicativo usa o agrupamento nativo do ErsatzTV para criar uma única entrada de EPG para o bloco e não envia `customTitle` individualmente para cada item.

O agrupamento existente em **Presentation Profiles -> Agrupar no EPG** permanece disponível e independente. O Universal continua em **v1.3.1**: a correção é feita na configuração gerada pelo aplicativo, aproveitando recursos que o motor já possuía.

## O que muda

- **Título customizado** ganha o checkbox **Agrupar itens no EPG usando este título** em Reprodução avançada;
- checkbox desligado: mantém o comportamento anterior, com `customTitle` aplicado individualmente aos itens;
- checkbox ligado: o gerador remove `custom_title` por item e produz `epg_group=true`, `epg_title=<Título customizado>` e `epg_advance=true` para o bloco;
- o agrupamento ligado ao Título customizado exige que o título esteja preenchido;
- **Presentation Profiles -> Agrupar no EPG** continua disponível para agrupamentos independentes do campo Título customizado;
- nenhuma alteração no mecanismo de downloads, bibliotecas, navegador read-only, fila, NFOs ou autenticação.

## Compatibilidade

- aplicação: **v3.4.17**;
- Universal: **v1.3.1**;
- `configVersion`: **8**;
- schema de Scripted Schedules: **1**;
- estado da fila de downloads: **4**.

Não existe migração obrigatória. Projetos que não usarem o novo checkbox continuam gerando o mesmo comportamento de Título customizado da versão anterior.

## Atualização

1. Pare o aplicativo.
2. Faça backup da instalação atual, como de costume.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.17-update.zip` sobre uma instalação v3.4.16.
4. Inicie o aplicativo novamente.
5. Faça um recarregamento completo do navegador (`Ctrl+F5`) para descartar JavaScript em cache.
6. Abra o Scripted Schedule desejado e publique novamente somente os projetos em que quiser usar o novo agrupamento.

## Verificação rápida

1. Abra **Scripted Schedules -> Programação**.
2. Em um bloco, abra **Reprodução avançada**.
3. Preencha **Título customizado**, por exemplo `MINHAS FAVORITAS`.
4. Com **Agrupar itens no EPG usando este título** desligado, valide a prévia: deve aparecer `custom_title: "MINHAS FAVORITAS"` e não deve haver agrupamento criado por esse campo.
5. Ligue o checkbox e valide novamente: o bloco deve conter `epg_group: True`, `epg_title: "MINHAS FAVORITAS"` e `epg_advance: True`, sem `custom_title: "MINHAS FAVORITAS"` naquele bloco.
6. Em **Recursos -> Presentation Profiles**, confirme que **Agrupar no EPG** continua disponível normalmente.

- upgrade esperado: **v3.4.16 -> v3.4.17**;
- projetos só precisam ser republicados quando você quiser que o `.py` publicado passe a refletir a nova opção;
- nenhum Reset Playout é necessário apenas para atualizar o aplicativo.
