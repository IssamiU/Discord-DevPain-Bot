# QA DevOps Bot — Discord + n8n

Bot de Discord para automação de auditoria de processos DevOps em times ágeis usando Scrum.

O sistema é composto por duas partes independentes que se comunicam:

- **Bot Discord** (Node.js) — registra dailys automáticas por canal de voz, gerencia impedimentos, consulta Jira via proxy e expõe endpoints HTTP para o n8n.
- **n8n** — orquestrador que roda a auditoria completa: busca dados no GitLab e Jira, calcula score de conformidade e envia relatórios para Discord, e-mail e Telegraph.

---

## Índice

1. [O que o sistema faz](#1-o-que-o-sistema-faz)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Configuração das credenciais](#3-configuração-das-credenciais)
4. [Rodando localmente](#4-rodando-localmente)
5. [Subindo na nuvem](#5-subindo-na-nuvem)
6. [Configurando o n8n](#6-configurando-o-n8n)
7. [Adaptando para seu projeto](#7-adaptando-para-seu-projeto)
8. [Comandos do bot](#8-comandos-do-bot)
9. [Endpoints HTTP](#9-endpoints-http)
10. [Persistência de dados](#10-persistência-de-dados)
11. [Estrutura de dados](#11-estrutura-de-dados)

---

## 1. O que o sistema faz

### Bot Discord

- Detecta quando 3+ membros entram no canal de voz da Daily e registra a reunião automaticamente (presença, duração, ausentes).
- Envia lembrete diário às 7h nos dias úteis e resumo de presença toda segunda-feira.
- Permite registrar e acompanhar impedimentos por sprint.
- Consulta Jira para exibir issues, backlog, changelog e resumo de sprint.
- Expõe endpoints HTTP consumidos pelo n8n (`/dailys`, `/impedimentos`).
- Backup automático de dados em GitHub Gist — survives redeploys.

### n8n (auditoria semanal)

Roda automaticamente nos dias e horários que você configurar e audita:

- **MRs** — aprovador diferente do autor, pipeline executada, branch no padrão.
- **Commits** — padrão Conventional Commits (`feat[ID]:`, `fix:`, `docs:` etc.).
- **Branches** — nomenclatura com tipo + ID numérico. Exceções configuráveis.
- **Documentação** — commits `docs:` ou alterações de README por repositório.
- **Testes** — arquivos `.spec.ts` nos diretórios de teste, nomenclatura `TC-XX-nome`.
- **Jira** — workflow de status das issues (To Do → In Progress → Review → Done).
- **Deploy** — releases formais criadas no GitLab (tag + release notes).
- **Daily + Impedimentos** — consumidos do bot via HTTP.

Gera um score ponderado de conformidade e envia para Discord, e-mail (SendGrid) e Telegraph.

---

## 2. Pré-requisitos

### Bot Discord

- Node.js v18+ (recomendado v22 LTS)
- Um bot criado no [Discord Developer Portal](https://discord.com/developers/applications)
- Permissões necessárias no bot: `bot`, `applications.commands`
- Intents necessários (ativar no portal): `SERVER MEMBERS INTENT`, `VOICE STATES`

### n8n

- n8n instalado localmente (`npm install -g n8n`) ou instância hospedada
- Conta no [Jira Cloud](https://atlassian.net) com API token
- Conta no [GitLab](https://gitlab.com) com Personal Access Token (escopo: `read_api`)
- Conta no [SendGrid](https://sendgrid.com) com API key (para e-mail)
- Token do [Telegraph](https://telegra.ph) (opcional, para relatório completo)

### Backup de dados

- Conta no GitHub
- [GitHub Gist](https://gist.github.com) privado criado com um arquivo `.json` vazio (ex: `BotData.json`)
- Personal Access Token com escopo `gist`

---

## 3. Configuração das credenciais

Copie o arquivo de exemplo e preencha com suas credenciais:

```bash
cp .env.example .env
```

Conteúdo do `.env`:

```env
# Discord
BOT_TOKEN=          # Token do bot (Discord Developer Portal → Bot → Token)
CLIENT_ID=          # ID da aplicação (Discord Developer Portal → General Information)
GUILD_ID=           # ID do servidor Discord (clique direito no servidor → Copiar ID)
CANAL_REMINDER=     # ID do canal onde o lembrete diário é enviado
CANAL_DAILY_VOZ=    # ID do canal de voz monitorado para dailys
CANAL_DAILY_LOG=    # ID do canal de texto onde logs de daily são postados
DAILY_MIN=3         # Mínimo de membros para iniciar daily automaticamente

# Jira
JIRA_DOMAIN=        # ex: minha-empresa.atlassian.net
JIRA_EMAIL=         # e-mail da conta Jira
JIRA_TOKEN=         # API token (Jira → Conta → Segurança → Criar token de API)
JIRA_BOARD=         # ID do board (número na URL do board)
JIRA_SPRINT_ID=     # ID numérico da sprint ativa (ver na URL da sprint no Jira)
JIRA_SPRINT_NAME=   # Nome da sprint (ex: "SCRUM Sprint 1")
JIRA_PROJECT=       # Prefixo do projeto Jira (ex: SCRUM, DEV, API)
JIRA_DEVOPS_LABEL=  # Label usada para issues de DevOps (ex: devops)
JIRA_DIAS_PARADA=7  # Dias sem atualização para considerar issue "parada"

# GitLab
GITLAB_TOKEN=       # Personal Access Token (GitLab → Preferências → Tokens de acesso)
GITLAB_GROUP=       # Namespace do grupo ou usuário (ex: meu-grupo)
GITLAB_REPOS=       # Slugs dos repos separados por vírgula (ex: grupo/repo1,grupo/repo2)

# n8n proxy (URL do webhook jira-proxy do seu n8n — ver seção 6)
N8N_PROXY=          # ex: https://meu-n8n.exemplo.com/webhook/jira-proxy

# GitHub Gist (backup dos dados do bot)
GITHUB_TOKEN=       # Personal Access Token com escopo "gist"
GIST_ID=            # ID do Gist (parte final da URL: gist.github.com/usuario/ESTE_ID)
GIST_FILENAME=      # Nome do arquivo dentro do Gist (ex: BotData.json)

# Servidor HTTP
PORT=3000
TZ=America/Sao_Paulo
```

> **IDs do Discord:** ative o modo desenvolvedor em Configurações → Avançado → Modo desenvolvedor. Depois, clique direito em qualquer canal, servidor ou usuário para copiar o ID.

> **Como encontrar o JIRA_SPRINT_ID:** abra a sprint ativa no Jira, a URL terá algo como `...?selectedIssue=SCRUM-1&sprint=68` — o número após `sprint=` é o ID.

---

## 4. Rodando localmente

### Bot Discord

```bash
# Instalar dependências
npm install

# Iniciar o bot
node bot.js
```

O bot registra os slash commands automaticamente no primeiro start. Você verá no terminal:

```
✅ Bot online: SeuBot#1234
[INIT] Arquivo local ok — 2 chaves
✅ Slash commands registrados
⏰ Lembrete diário agendado
```

> **Limitação local:** o lembrete diário às 7h e o resumo semanal de segunda só funcionam se o bot estiver rodando continuamente. Para automação real, use um servidor ou plataforma de nuvem.

### n8n local

```bash
# Instalar e iniciar
npm install -g n8n
n8n start
```

Acesse `http://localhost:5678`, importe o arquivo `examples/n8n-auditoria-example.json` e configure suas credenciais direto no Code node (ver seção 6).

> **Limitação local:** o agendamento do n8n só dispara enquanto a instância estiver rodando. Para execuções automáticas, hospede o n8n em um servidor.

---

## 5. Subindo na nuvem

O bot e o n8n são aplicações Node.js simples e rodam em qualquer plataforma que suporte containers ou Node.js diretamente. Algumas opções comuns:

- **Render** — suporta deploy via GitHub, tem plano gratuito (com limitações de hibernação). Usado no projeto original.
- **Railway** — similar ao Render, plano trial com créditos mensais e disco persistente.
- **Fly.io** — suporte a containers Docker, bom para n8n.
- **VPS própria** (DigitalOcean, Vultr, Hetzner etc.) — controle total, sem limitações de hibernação.

> **Atenção com planos gratuitos:** plataformas como Render Free hibernam o serviço após ~15 minutos sem requisição. Use um monitor de uptime (ex: UptimeRobot) para pingar o servidor periodicamente e evitar hibernação — o bot expõe `/health` para isso.

> **Variáveis com múltiplos valores no Render** (ex: `GITLAB_REPOS`): coloque tudo em uma única linha como chave/valor normal — o Render não suporta arrays, mas o bot lê a string e divide por vírgula automaticamente.

Para o **n8n na nuvem**, a variável de ambiente obrigatória é:

```env
GENERIC_TIMEZONE=America/Sao_Paulo   # ou seu fuso horário
N8N_ENCRYPTION_KEY=chave-secreta-aleatoria
```

---

## 6. Configurando o n8n

### Importando o fluxo de auditoria

1. Abra sua instância n8n
2. Clique em `...` → `Import from file`
3. Importe `examples/n8n-auditoria-example.json`
4. Abra o **Code node** e preencha as constantes no topo:

```javascript
const GITLAB_TOKEN = 'seu-token-aqui';
const DISCORD_URL  = 'https://discord.com/api/webhooks/...';
const JIRA_DOMAIN  = 'sua-empresa.atlassian.net';
const JIRA_EMAIL   = 'seu@email.com';
const JIRA_TOKEN   = 'seu-token-jira';
const SENDGRID_KEY = 'SG.sua-chave';
const GL_GROUP     = 'seu-grupo-gitlab';
const JIRA_BOARD   = 1;  // ID do seu board
```

Ajuste também a data de início da sprint e o nome do repositório principal:

```javascript
const sprintStart    = new Date('2026-01-01T00:00:00.000Z'); // início da sua sprint
const MAIN_REPO_SLUG = 'seu-grupo/seu-repo-principal';       // repo que não exige MR
```

5. Configure o **Schedule Trigger** com os dias e horários desejados
6. Salve (`Ctrl+S`) e clique em **Publish** para ativar

### Importando o fluxo proxy do Jira

O bot Discord não chama o Jira diretamente — usa o n8n como proxy intermediário (necessário por limitações de timeout em alguns ambientes de nuvem).

1. Importe `examples/n8n-jira-proxy-example.json`
2. Preencha as credenciais Jira no Code node do proxy
3. A URL do webhook gerado pelo n8n é o valor que vai em `N8N_PROXY` no `.env` do bot

> Se o seu ambiente não tiver o problema de timeout com o Jira, você pode chamar a API do Jira diretamente no bot e remover a dependência do proxy.

### Telegraph (opcional)

O Telegraph cria uma página pública com o relatório completo (sem limite de caracteres, diferente do Discord). Para usar:

1. Crie um token: `curl https://api.telegra.ph/createAccount?short_name=QABot`
2. Guarde o `access_token` retornado e coloque no Code node do n8n

---

## 7. Adaptando para seu projeto

### Bot — o que mudar a cada nova sprint

No `bot.js`, a função `getSprintKey()` retorna uma string que identifica a sprint atual. Atualize a cada nova sprint:

```javascript
function getSprintKey() { return 'sprint-1-2025'; } // mude aqui
```

Isso isola os dados (dailys, impedimentos) por sprint no arquivo JSON.

Atualize também as variáveis de ambiente `JIRA_SPRINT_ID` e `JIRA_SPRINT_NAME` para apontar para a sprint ativa.

### Bot — membros do Jira

O array `JIRA_MEMBROS` mapeia nomes de exibição para `accountId` do Jira (usado no comando `/issue-responsavel`):

```javascript
const JIRA_MEMBROS = [
  { nome: 'Nome Exibição', accountId: 'id-da-conta-no-jira' },
  // ...
];
```

Para encontrar o `accountId`: no Jira, acesse o perfil do usuário — o ID aparece na URL ou via API `GET /rest/api/3/myself`.

### Bot — repositórios auditados para deploy

A variável `GITLAB_REPOS` define quais repositórios são verificados pelo `/ultimo-deploy` e `/historico-deploy`. Configure via variável de ambiente como uma lista separada por vírgula:

```env
GITLAB_REPOS=seu-grupo/repo-1,seu-grupo/repo-2,seu-grupo/repo-3
```

No Render (ou outra plataforma nuvem), adicione uma única variável de ambiente `GITLAB_REPOS` com todos os repos na mesma linha separados por vírgula.

### n8n — padrões de branch e commit

No Code node da auditoria, os padrões são definidos por regex. Ajuste conforme o padrão do seu time:

```javascript
// Branches válidas — deve ter tipo + ID numérico em algum formato
const branchValidPattern = /^(feat|fix|docs|refactor|chore|test|hotfix|release)[\s\-\/\[].*\d+/i;

// Branches que nunca são auditadas (exceções permanentes)
const branchExceptions = /^(main|develop|master|HEAD|ReleaseSprint|integration)/i;

// Commits válidos — Conventional Commits
const commitValidPattern = /^(feat|fix|docs|refactor|style|test|chore)(\[[\w,\s\-]+\])?:/i;
```

### n8n — pesos do score

O score ponderado é calculado ao final do Code node. Ajuste os pesos conforme a prioridade do seu time:

```javascript
const pctGeral = Math.round(
  mrPct     * 0.25 +  // MRs
  commitPct * 0.25 +  // Commits
  branchPct * 0.15 +  // Branches
  docPct    * 0.15 +  // Documentação
  testPct   * 0.10 +  // Testes
  jiraPct   * 0.10    // Jira
);
```

### n8n — repositório principal (sem MR obrigatório)

Se um repositório do seu grupo não exige MR (ex: repo de documentação ou submódulos), adicione-o como exceção:

```javascript
const MAIN_REPO_SLUG = 'seu-grupo/repo-sem-mr';
```

Commits diretos nesse repo não geram alertas.

---

## 8. Comandos do bot

### Daily Scrum

| Comando | O que faz |
|---|---|
| *(automático)* | 3+ membros no canal de voz inicia o registro da daily |
| `/daily-status` | Status das dailys da semana atual (por dia, presença individual) |
| `/historico-dailys` | Todas as dailys registradas, separadas por semana |

### Impedimentos

| Comando | O que faz |
|---|---|
| `/impedimento <descrição> [tarefa]` | Registra um impedimento público com ID único |
| `/impedimento-resolvido <id>` | Marca um impedimento como resolvido |
| `/meus-impedimentos` | Seus impedimentos da semana atual |
| `/impedimentos-time` | Impedimentos de todo o time na semana atual |
| `/historico-impedimentos` | Todos os impedimentos de todas as semanas |

### Limpeza

| Comando | O que faz |
|---|---|
| `/limpar-resolvidos-semana` | Remove impedimentos resolvidos da semana atual |
| `/limpar-resolvidos-tudo` | Remove impedimentos resolvidos de todo o histórico |
| `/limpar-impedimentos-semana` | Remove todos os impedimentos da semana atual |
| `/limpar-impedimentos-tudo` | Remove todos os impedimentos do histórico |

### Jira

| Comando | O que faz |
|---|---|
| `/resumo-jira` | Relatório completo da sprint com todas as issues |
| `/issue-responsavel <membro>` | Issues da sprint de um membro específico |
| `/backlog` | User stories sem sprint atribuída |
| `/issues-sem-responsavel` | Issues da sprint sem ninguém atribuído |
| `/issues-devops` | Issues com a label de DevOps |
| `/issues-paradas` | Issues Em Andamento sem atualização há mais de N dias |
| `/changelog-issue <SCRUM-XX>` | Histórico de transições de uma issue (aceita número simples: `85`) |

### Deploy

| Comando | O que faz |
|---|---|
| `/ultimo-deploy` | Último release formal registrado no GitLab |
| `/historico-deploy` | Todos os releases de todos os repositórios |

### Confluence

| Comando | O que faz |
|---|---|
| `/confluence` | Acessa qualquer página via dropdown |
| `/user-stories` | User stories do projeto |
| `/requisitos` | Requisitos do projeto |
| `/regras-de-negocio` | Regras de negócio |
| `/backlog-produto` | Backlog do produto |

### Manutenção

| Comando | O que faz |
|---|---|
| `/backup-dados` | Exporta o JSON de dados como arquivo anexo |
| `/restaurar-dados` | Puxa os dados do Gist e aplica localmente (sem redeploy) |
| `/ajuda` | Lista todos os comandos |

---

## 9. Endpoints HTTP

O bot expõe um servidor HTTP na porta `PORT` (padrão: 3000). Esses endpoints são consumidos pelo n8n durante a auditoria.

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Health check — retorna `OK` |
| `GET` | `/dailys?semana=semana-2026-22` | Dailys de uma semana específica |
| `GET` | `/impedimentos?sprint=sprint-3-2026` | Impedimentos de uma sprint |
| `GET` | `/backup-dados` | JSON completo dos dados do bot |
| `POST` | `/restaurar-dados` | Restaura dados do Gist (mesmo que o slash command) |

A chave de semana segue o formato ISO: `semana-ANO-SEMANA` (ex: `semana-2026-22` = 22ª semana de 2026). Se omitida, retorna a semana atual.

---

## 10. Persistência de dados

Os dados do bot são armazenados em `impedimentos.json` no diretório local. Em ambientes de nuvem sem disco persistente (como Render Free), esse arquivo é perdido a cada redeploy.

### Solução: GitHub Gist como backup

A cada escrita (`saveData()`), o bot atualiza automaticamente um Gist privado no GitHub. No startup, se o arquivo local estiver vazio, o bot restaura do Gist automaticamente.

**Fluxo de um redeploy:**

```
Redeploy → arquivo local vazio → bot lê Gist → restaura dados → continua normalmente
```

**Editar dados manualmente:**

1. Edite o arquivo no Gist diretamente pelo GitHub
2. Execute `/restaurar-dados` no Discord **ou** faça um redeploy

> Depois de `/restaurar-dados`, o Gist não é sobrescrito imediatamente. Na próxima ação que gera dados (daily, impedimento), o Gist é atualizado com o estado atual do arquivo local.

---

## 11. Estrutura de dados

O arquivo `impedimentos.json` tem esta estrutura:

```json
{
  "semana-2026-22": {
    "_dailys": [
      {
        "id": "abc123",
        "data": "2026-05-27T23:00:00.000Z",
        "diaSemana": "Terça",
        "inicio": "2026-05-27T23:00:00.000Z",
        "fim": "2026-05-27T23:22:00.000Z",
        "duracaoMin": 22,
        "presentes": [{ "id": "discord-user-id", "nome": "Fulano" }],
        "ausentes":  [{ "id": "discord-user-id", "nome": "Ciclano" }],
        "totalMembros": 6
      }
    ],
    "discord-user-id": {
      "nome": "username",
      "impedimentos": [
        {
          "id": "xyz789",
          "descricao": "Não consigo acessar o ambiente de dev",
          "tarefa": "SCRUM-42",
          "data": "2026-05-28T10:00:00.000Z",
          "resolvido": false,
          "dataResolucao": null,
          "arrastado": false
        }
      ]
    }
  },
  "sprint-3-2026": {
    "_dailys": [ /* mesma estrutura — dailys acumuladas por sprint */ ],
    "discord-user-id": { /* impedimentos da sprint inteira */ }
  }
}
```

**Chaves usadas:**

- `semana-YYYY-WW` — dados semanais (dailys e impedimentos da semana)
- `sprint-X-YYYY` — dados da sprint inteira (dailys e impedimentos acumulados)
- `_dailys` — prefixo `_` indica campo de sistema, não é um usuário

---

## Arquivos de exemplo

```
examples/
  n8n-auditoria-example.json    # Fluxo do webhook de auditoria (sem credenciais)
  n8n-jira-proxy-example.json   # Fluxo do proxy Jira para o bot (sem credenciais)
```

Importe esses arquivos no n8n e preencha as credenciais conforme a seção 6.

---

## Licença

Use, modifique e distribua livremente para qualquer projeto pessoal, acadêmico ou profissional