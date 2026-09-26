# Atualização para 3.0.2

A versão 3.0.2 é uma atualização corretiva de interface sobre a v3.0.1. Não altera o schema de configuração, a fila persistente, autenticação, caminhos de mídia ou regras de download.

## Antes de atualizar

Como prática de segurança, mantenha backup da configuração e dos dados persistentes:

```bash
cp config/config.json "config/config.json.bak-$(date +%Y%m%d-%H%M%S)"
[ ! -f config/auth.json ] || cp config/auth.json "config/auth.backup-$(date +%Y%m%d-%H%M%S).json"
cp -a data "data.bak-$(date +%Y%m%d-%H%M%S)"
```

## Aplicar o pacote update

Pare o processo, extraia `ErsatzTV-YouTube-Downloader-v3.0.2-update.zip` por cima da instalação v3.0.1 e valide:

```bash
npm run check
npm test
```

Depois reinicie o processo normalmente. O pacote update não contém `config/config.json`, `config/auth.json` nem a pasta `data`.

## O que muda

- Barra inferior móvel em carrossel horizontal de uma única linha.
- Ocultação ao rolar para baixo e reaparecimento ao rolar para cima.
- Toque/gesto compatível faz a barra reaparecer quando estiver oculta.
- Ocultação automática após alguns segundos de inatividade.
- Safe-area e espaço de conteúdo preservados para evitar sobreposição visual.

## Compatibilidade

A v3.0.2 mantém `configVersion: 5` e o mesmo formato de estado da v3.0.1. Não há migração adicional nesta atualização.

## Rollback

Como não há mudança de schema ou persistência, o rollback para v3.0.1 é apenas a restauração dos arquivos de código da versão anterior. Configuração, autenticação, fila e arquivos de mídia devem ser preservados.
