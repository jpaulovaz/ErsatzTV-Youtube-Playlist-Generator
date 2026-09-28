# Atualização para 3.3.0

A versão 3.3.0 adiciona **Pad To Nearest Minute** aos módulos de conteúdo de Scripted Schedules. É uma evolução compatível da v3.2.1 e não altera Downloads, Bibliotecas ou Canais.

## O que muda

- Novo motor Universal v1.2.0 com alinhamento opcional após blocos/eventos.
- Valores disponíveis: 5, 10, 15 e 30 minutos.
- A opção fica desativada por padrão em todos os módulos.
- O alinhamento usa o Filler já configurado no projeto; não cria um segundo Filler.
- Sem Filler, a interface não permite ativar a opção e o backend também rejeita configurações inconsistentes.
- OFFLINE_WINDOWS e o próprio Filler não recebem esta opção.
- Projetos existentes no motor v1.1.1 continuam publicáveis sem mudança automática de motor.
- Para usar Pad To Nearest Minute em um projeto antigo, use **Atualizar motor** na aba Geral e publique o projeto.

## Atualização

Pare o processo, extraia `ErsatzTV-YouTube-Downloader-v3.3.0-update.zip` sobre uma instalação v3.2.1 e inicie novamente.

O pacote UPDATE não inclui `config/config.json`, `config/auth.json` nem `data/`. Projetos existentes em `data/scripted-schedules/` são preservados.

## Compatibilidade

- `configVersion`: permanece 8.
- schema do módulo Scripted Schedules: permanece 1.
- motores suportados: Universal v1.1.1 e v1.2.0.
- motor padrão para novos projetos: Universal v1.2.0.
- upgrade esperado: v3.2.1 -> v3.3.0.
