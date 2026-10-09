# Atualização para 3.9.5

A versão 3.9.5 é uma atualização incremental sobre a **v3.9.4**, focada em deixar inequívocos os estados de Biblioteca no Acervo local e permitir validar um Video ID recuperado diretamente no item, sem abrir Revisar. Não há migração de configuração nem alteração de schema.

## Versionamento

- aplicação: **v3.9.5**;
- Universal Scripted Schedules: **v1.3.1**;
- `configVersion`: **9**;
- Download state: **5**;
- Scripted Schedules schema: **1**;
- Subtitle Manager state: **1**;
- Subtitle Translation config/state: **1**;
- YouTube Manager state: **1**;
- YouTube Account config/state: **1**;
- Adoption transaction state: **1**.

## Atualização

Pare o serviço, faça backup da instalação e extraia o pacote incremental sobre a instalação v3.9.4:

```bash
unzip -o /caminho/ErsatzTV-YouTube-Downloader-v3.9.4-to-v3.9.5-update.zip -d /caminho/da/aplicacao
```

Depois reinicie o serviço. Não substitua `config/config.json`, `config/auth.json`, `config/youtube-account.json`, `data/` ou arquivos de mídia; eles não fazem parte do pacote de atualização.

## Mudanças visíveis no Acervo local

O filtro **Biblioteca** agora oferece:

- Todos;
- **Não está em nenhuma Biblioteca**;
- **Já está em alguma Biblioteca**;
- **Sincronizado, aguardando mídia**;
- **Mídia presente**;
- **Adotado**.

Os estados são calculados comparando o Video ID do item com o Download State real. `Mídia presente` representa um destino com arquivo físico já existente e que não está marcado como adoção; `Adotado` representa explicitamente um destino concluído pelo fluxo de adoção. Um mesmo vídeo pode aparecer em mais de um destino e, nesse caso, pode satisfazer mais de um filtro conforme o estado de cada destino.

Itens com **ID recuperado** passam a exibir **Validar ID** diretamente no card. Essa ação valida o ID encontrado em filename/sidecar/metadata embedded e, quando aprovado, transforma o item em **Confirmado** sem abrir o painel Revisar. As regras são as mesmas da validação em lote:

- conflito do mesmo Video ID entre arquivos: bloqueado;
- vídeo indisponível: bloqueado;
- diferença de duração acima de 45 s: bloqueada e encaminhada para Revisar;
- diferença acima de 10 s e até 45 s: confirmada com aviso;
- demais casos válidos: confirmados diretamente.

O botão individual **Adotar** aparece somente quando o item está Confirmado e existe ao menos um destino gerenciado sincronizado que ainda aguarda mídia. Se a mídia já está presente, ou se o Video ID ainda não pertence a nenhum destino gerenciado, não há adoção útil a executar naquele momento.

## Validação após atualizar

1. Abra **YouTube → Gerenciador do YouTube → Acervo local**.
2. Escolha uma fonte já varrida.
3. Teste **Biblioteca → Não está em nenhuma Biblioteca** e confirme que só aparecem IDs sem destino gerenciado.
4. Teste **Sincronizado, aguardando mídia**, **Mídia presente** e **Adotado** conforme os estados existentes.
5. Em um item **ID recuperado**, clique em **Validar ID**; quando aprovado, ele deve mudar para **Confirmado** sem abrir Revisar.
6. Se o item confirmado possuir destino sincronizado sem mídia, o botão **Adotar** deve aparecer.

Não é necessário recriar OAuth, revarrer o acervo ou refazer matches já confirmados.
