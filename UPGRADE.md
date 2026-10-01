# Atualização para 3.4.13

A versão 3.4.13 amplia somente a **Ajuda de Scripted Schedules**, com um guia completo para Sources do tipo **Search**. O Universal permanece v1.3.1 e não há mudança no motor, schema, fila de downloads ou formato dos projetos.

## O que muda

- nova aba **Queries** dentro de Ajuda;
- campos de pesquisa do ErsatzTV organizados por assunto, com explicação curta e indicação dos tipos de mídia em que cada campo é aceito;
- inclusão dos campos especiais de data (`released_inthelast`, `released_notinthelast`, `released_onthisday`, `added_inthelast`, `added_notinthelast`);
- exemplos de `AND`, `OR`, `NOT`, curingas com `*`, aspas e intervalos de data;
- a ajuda contextual do campo Query passa a apontar para **Ajuda → Queries**;
- aviso explícito sobre Remote Streams: o ErsatzTV informa que eles são pesquisáveis, mas a documentação Legacy não enumera um conjunto próprio de campos, então a interface não inventa parâmetros.

## Compatibilidade

- aplicação: **v3.4.13**;
- Universal: **v1.3.1**;
- `configVersion`: **8**;
- schema de Scripted Schedules: **1**;
- estado da fila de downloads: **4**.

Projetos, arquivos `.py`, `state_key`, configuração, autenticação, dados, downloads e NFOs não precisam de migração.

## Atualização

1. Pare o aplicativo.
2. Faça backup da instalação atual, como de costume.
3. Extraia `ErsatzTV-YouTube-Downloader-v3.4.13-update.zip` sobre a instalação v3.4.12.
4. Inicie o aplicativo novamente.
5. Faça um recarregamento completo do navegador (`Ctrl+F5`) para descartar arquivos JavaScript/CSS em cache.

## Verificação rápida

Abra **Programação → Ajuda → Queries**. A tela deve mostrar os grupos de campos, exemplos de consulta e a seção de datas especiais.

- upgrade esperado: **v3.4.12 -> v3.4.13**;
- nenhuma republicação dos Scripted Schedules é necessária;
- nenhum Reset Playout é necessário.
