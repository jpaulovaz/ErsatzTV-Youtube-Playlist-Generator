# ErsatzTV YouTube Downloader 2.0

Aplicativo Node.js para descobrir vídeos de playlists e URLs individuais do YouTube, enfileirar downloads persistentes e entregar arquivos locais ao ErsatzTV.

A versão 2.0 substitui a arquitetura de Remote Streams/YML por arquivos de vídeo completos. O `yt-dlp` trabalha durante a preparação da biblioteca, não no momento em que o canal está sendo reproduzido.

## Arquitetura

```text
Playlist ou vídeo do YouTube
          ↓
Descoberta (YouTube Data API ou yt-dlp)
          ↓
Deduplicação por videoId
          ↓
Fila persistente, um item por vez
          ↓
yt-dlp + ffmpeg/ffprobe
          ↓
MP4 / H.264 / AAC + JPG
          ↓
Biblioteca local do ErsatzTV
```

## Principais recursos

- Uma ou mais bibliotecas, cada uma com várias fontes.
- Fontes do tipo playlist e vídeo individual.
- YouTube Data API como modo preferencial, com fallback automático para `yt-dlp`.
- Fila persistente em JSON; reiniciar o aplicativo não perde os itens pendentes.
- Um download simultâneo, evitando picos de CPU, rede e disco.
- Arquivos finais padronizados em MP4, vídeo H.264 e áudio AAC.
- Resolução máxima geral ou específica por biblioteca: 360p, 480p, 720p, 1080p, 1440p e 2160p.
- Organização `Biblioteca/Artista/Artista - Título.mp4`.
- Thumbnail JPG ao lado do vídeo.
- Deduplicação por ID do YouTube, independentemente de alterações futuras no título.
- Retentativas automáticas após 1, 5 e 15 minutos.
- Pausa automática quando o espaço livre fica abaixo da reserva configurada.
- Itens removidos de uma fonte são marcados como órfãos e nunca apagados automaticamente.
- Controles de pausar, retomar, cancelar, priorizar, remover e tentar novamente.
- Scan da biblioteca e rebuild do playout quando a fila entra em repouso.
- Limpeza manual de órfãos e de arquivos legados `.yml`.
- Migração automática da configuração da versão 1.

## Requisitos

- Linux recomendado.
- Node.js 18 ou superior.
- `yt-dlp` atualizado.
- `ffmpeg` e `ffprobe`.
- Acesso de gravação à pasta definida em `paths.baseDir`.
- ErsatzTV acessível pela rede para scan/rebuild automáticos.
- Opcional: Deno para os desafios JavaScript atuais do YouTube.
- Opcional: uma YouTube Data API Key.
- Opcional: `cookies.txt` em formato Netscape para vídeos que exigem sessão.

Exemplo de verificação:

```bash
node --version
/usr/local/bin/yt-dlp --version
/usr/bin/ffmpeg -version | head -n 1
/usr/bin/ffprobe -version | head -n 1
/usr/local/bin/deno --version
```

## Instalação nova

1. Extraia o pacote completo em uma pasta permanente.
2. Ajuste `config/config.json` pela interface ou use `config/config.example.json` como referência.
3. Valide o projeto:

```bash
npm run verify
```

4. Inicie:

```bash
npm start
```

5. Acesse:

```text
http://ENDERECO_DO_SERVIDOR:3099
```

O projeto não usa dependências npm externas nesta versão; `npm install` não é necessário para a execução normal.

## Atualização direta da versão 1

Use o pacote `update`, extraindo-o por cima da instalação atual. Esse pacote não contém `config/config.json` nem o conteúdo de `data/`, portanto preserva a configuração e o estado operacional existentes.

Na primeira inicialização da versão 2:

1. `config/config.json` é lido no formato antigo.
2. Os campos úteis são migrados.
3. É criado `config/config.v1.backup-AAAAmmdd-HHMMSS.json`.
4. O novo `config/config.json` é gravado com `configVersion: 2`.

São preservados, quando existentes:

- host e porta da interface;
- pasta base;
- caminho do `yt-dlp`;
- bibliotecas e respectivas fontes;
- resolução máxima;
- runtime JavaScript;
- URL e IDs do ErsatzTV;
- estado do agendador.

O antigo `streamScriptPath` é descartado. Um caminho legado de script não ativa cookies automaticamente. Cookies só são usados quando `paths.cookiesPath` ou o campo da biblioteca estiver explicitamente preenchido.

Consulte também [UPGRADE.md](UPGRADE.md).

## Estrutura dos arquivos

Com uma biblioteca chamada `Mix_Principal`, o resultado é semelhante a:

```text
/srv/media/youtube/
├── .youtube-downloader-work/        # arquivos temporários; não é biblioteca
└── Mix_Principal/
    ├── Queen/
    │   ├── Queen - Bohemian Rhapsody.mp4
    │   └── Queen - Bohemian Rhapsody.jpg
    └── Outros/
        ├── Vídeo sem separador de artista.mp4
        └── Vídeo sem separador de artista.jpg
```

O aplicativo divide o título no primeiro ` - ` ou hífen reconhecido. Quando não consegue determinar o artista, usa a pasta `Outros`.

Em caso de colisão de nome, o ID do YouTube é acrescentado ao arquivo. O índice interno continua sendo o `videoId`.

O nome da biblioteca também é sua identidade interna e define a pasta física. Renomeá-la depois que a fila já possui itens é tratado como a criação de outra biblioteca; não use uma simples renomeação para mover arquivos existentes. Mudanças de `paths.baseDir` também devem ser feitas com a fila parada e com migração planejada dos arquivos e do estado.

## Configuração no ErsatzTV

Use uma biblioteca local do tipo **Music Videos** para o conteúdo musical. Para cada biblioteca do aplicativo, adicione ao ErsatzTV a pasta correspondente, por exemplo:

```text
/srv/media/youtube/Mix_Principal
```

Aponte o `Library ID` do aplicativo para a biblioteca local que deve receber o scan. O `Playout ID` é opcional e serve para rebuild automático depois que a fila entra em repouso.

Não apague a biblioteca Remote Streams antiga antes de validar a nova biblioteca local. Depois que os MP4 forem reconhecidos e reproduzidos corretamente, use `Limpar YML antigos` no aplicativo e remova a configuração antiga no ErsatzTV.

## Descoberta e fila

`Buscar novidades` não baixa tudo ao mesmo tempo. A descoberta atualiza o índice e acrescenta somente itens desconhecidos à fila.

Estados principais:

- `pending`: aguardando a vez ou uma retentativa;
- `downloading`: download/processamento em andamento;
- `completed`: arquivo local validado;
- `failed`: esgotou as tentativas automáticas;
- `cancelled`: cancelado pelo operador;
- `orphaned`: não está mais nas fontes atuais, mas foi preservado;
- `removed`: retirado manualmente da fila e suprimido até uma ação de retry.

Ao reiniciar o aplicativo, um item que estava em `downloading` volta para `pending`. Arquivos temporários ficam em `.youtube-downloader-work` e não são apresentados ao ErsatzTV como itens concluídos.

## Compatibilidade de mídia

O aplicativo tenta obter H.264/AAC diretamente quando a resolução é 1080p ou inferior. Para resoluções maiores, pode baixar codecs como VP9/AV1 e normalizar o arquivo localmente.

Antes de concluir um item:

1. `ffprobe` valida que há vídeo e áudio.
2. Quando necessário, `ffmpeg` remuxa o container.
3. Se os codecs não forem H.264/AAC, `ffmpeg` transcodifica.
4. O arquivo final é validado novamente.
5. Somente então ele é movido para o destino `.mp4`.

Um arquivo final preexistente que falhar na validação é preservado com sufixo `.invalid-TIMESTAMP` para análise, em vez de ser sobrescrito silenciosamente.

## Espaço em disco

A interface mostra total, usado e livre. Por padrão, novos downloads são bloqueados quando o espaço disponível fica abaixo de 20 GB.

A pausa por pouco espaço não exclui arquivos nem remove itens da fila. Depois de liberar espaço, o worker volta a prosseguir automaticamente.

## Órfãos

Quando um vídeo deixa de pertencer às fontes configuradas:

- o arquivo local é preservado;
- o item recebe marcação de órfão;
- não há exclusão automática;
- a interface permite visualizar e remover órfãos de forma explícita.

A limpeza de órfãos remove o MP4, a thumbnail, o estado daquele item e pastas de artista que ficarem vazias.

## Cookies

Cookies são opcionais. Deixe ambos os campos vazios para executar sem `--cookies`:

- `paths.cookiesPath`: padrão global;
- `cookiesPath` dentro de uma biblioteca: sobrescreve o padrão global.

O botão `Testar cookies` realiza uma consulta simulada por `yt-dlp`. Um arquivo antigo pode expirar ou ser rotacionado pelo YouTube; nesse caso, substitua-o por uma exportação nova ou deixe o campo vazio quando o conteúdo for público.

Nunca armazene o conteúdo dos cookies diretamente no JSON; informe somente o caminho do arquivo e restrinja suas permissões:

```bash
chmod 600 /caminho/cookies.txt
```

## YouTube Data API

Quando habilitada no modo `api`, a API é usada para descobrir IDs e metadados. Se a API falhar ou receber uma fonte não suportada, o aplicativo tenta `yt-dlp` para aquela descoberta.

A API não substitui o `yt-dlp` para baixar vídeo e áudio.

## Agendador

O intervalo recomendado é 360 minutos. O agendador apenas procura novidades e alimenta a fila; o worker continua processando itens independentemente do agendador.

`runOnStartup` dispara uma descoberta logo após a inicialização. Em uma migração com uma playlist grande, isso pode enfileirar imediatamente todos os vídeos ainda não registrados.

## Ações do ErsatzTV

Quando a fila fica sem item executável e existem arquivos novos:

1. o aplicativo espera `idleActionDelaySeconds`;
2. solicita scan usando `Library ID`, se configurado;
3. solicita rebuild usando `Playout ID`, se configurado;
4. registra o resultado no estado da biblioteca.

Isso evita um scan para cada vídeo individual.

## Remoção de bibliotecas

- `Remover configuração` retira a biblioteca do JSON e preserva todos os arquivos.
- `Excluir biblioteca e arquivos` exige digitar exatamente o nome e remove a pasta, os itens do índice e os temporários relacionados.

A segunda ação é destrutiva e não possui restauração automática.

## Arquivos de estado

```text
config/config.json                  configuração ativa
data/download-state.json            fila, histórico e índice por videoId
data/app.log                        log operacional
.youtube-downloader-work/           arquivos temporários dentro da pasta base
```

Faça backup de `config/` e `data/`. A mídia pode ser copiada separadamente conforme sua política de armazenamento.

## Comandos

```bash
npm start          # interface + worker + agendador
npm run sync       # uma descoberta pelo terminal
npm run check      # valida sintaxe JavaScript
npm test           # testes automatizados
npm run verify     # sintaxe + testes
```

## Serviço systemd

Há um exemplo em:

```text
deploy/ersatztv-youtube-downloader.service.example
```

Ajuste `User`, `Group` e `WorkingDirectory`, copie para `/etc/systemd/system/ersatztv-youtube-downloader.service` e execute:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ersatztv-youtube-downloader
sudo journalctl -u ersatztv-youtube-downloader -f
```

## Segurança operacional

- Não exponha a interface diretamente à internet sem autenticação/reverse proxy.
- Proteja API Keys, cookies e backups da configuração.
- O processo precisa escrever apenas na pasta da aplicação, na pasta base e nos arquivos de log/estado.
- Antes de usar exclusões, mantenha um backup ou snapshot do armazenamento.
