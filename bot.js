const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs   = require('fs');
const axios = require('axios');
const http  = require('http');

// ─── CONFIGURAÇÃO ────────────────────────────────────────────────────────────

const BOT_TOKEN       = process.env.BOT_TOKEN;
const CLIENT_ID       = process.env.CLIENT_ID;
const GUILD_ID        = process.env.GUILD_ID;
const CANAL_REMINDER  = process.env.CANAL_REMINDER;
const CANAL_DAILY_VOZ = (process.env.CANAL_DAILY_VOZ || '').trim();
const CANAL_DAILY_LOG = (process.env.CANAL_DAILY_LOG || '').trim();
const DAILY_MIN       = parseInt(process.env.DAILY_MIN || '3', 10);

const JIRA_DOMAIN       = process.env.JIRA_DOMAIN       || '';
const JIRA_EMAIL        = process.env.JIRA_EMAIL        || '';
const JIRA_TOKEN        = process.env.JIRA_TOKEN        || '';
const JIRA_BOARD        = process.env.JIRA_BOARD        || '';
const JIRA_SPRINT_ID    = process.env.JIRA_SPRINT_ID    || '';
const JIRA_SPRINT_NAME  = process.env.JIRA_SPRINT_NAME  || '';
const JIRA_PROJECT      = process.env.JIRA_PROJECT      || '';
const JIRA_DEVOPS_LABEL = process.env.JIRA_DEVOPS_LABEL || '';
const JIRA_DIAS_PARADA  = parseInt(process.env.JIRA_DIAS_PARADA || '7', 10);
const JIRA_BOARD_URL    = `https://${JIRA_DOMAIN}/jira/software/projects/${JIRA_PROJECT}/boards/${JIRA_BOARD}`;

const N8N_PROXY     = process.env.N8N_PROXY     || '';
const GITLAB_TOKEN  = process.env.GITLAB_TOKEN  || '';
const GITLAB_GROUP  = process.env.GITLAB_GROUP  || '';
// Liste aqui os slugs dos repositórios GitLab do seu grupo (formato: 'grupo/repo')
const GITLAB_REPOS  = (process.env.GITLAB_REPOS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GIST_ID      = process.env.GIST_ID      || '';
const GIST_FILE    = process.env.GIST_FILENAME || '';

const DATA_FILE = './impedimentos.json';

const JIRA_MEMBROS = [
  { nome: 'Otávio Vianna Lima',        accountId: '61bae2acf19b53006a9cdc45' },
  { nome: 'Issami Umeoka',             accountId: '712020:84525927-9631-4c24-adfa-bee26d5c0a26' },
  { nome: 'Guilherme Almeida',         accountId: '712020:1dadb4c4-bc15-4454-aa9c-29e7d4eea8c3' },
  { nome: 'Guilherme Almeida Camargo', accountId: '712020:1c63f1bf-e0d5-4e90-a3b1-52c6af494f75' },
  { nome: 'Gustavo Camargo',           accountId: '712020:a81b9d69-9e0e-45ed-b0ba-2595fb50212b' },
  { nome: 'Tiago Freitas',             accountId: '712020:90d6d35f-ecb6-43b7-b81f-6f27fb768613' },
  { nome: 'Matheus de Castro',         accountId: '712020:fc3f9028-2b3c-44eb-8268-67eafe4e1d3b' },
];

// ─── GIST (BACKUP REMOTO) ────────────────────────────────────────────────────

async function gistRead() {
  if (!GITHUB_TOKEN || !GIST_ID) return null;
  try {
    const res = await axios.get(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
      timeout: 10000,
    });
    const content = res.data?.files?.[GIST_FILE]?.content;
    return content ? JSON.parse(content) : null;
  } catch (e) {
    console.error('[GIST READ ERROR]', e.message);
    return null;
  }
}

async function gistWrite(data) {
  if (!GITHUB_TOKEN || !GIST_ID) return;
  try {
    await axios.patch(`https://api.github.com/gists/${GIST_ID}`, {
      files: { [GIST_FILE]: { content: JSON.stringify(data, null, 2) } },
    }, {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
      timeout: 10000,
    });
    console.log('[GIST] Backup atualizado');
  } catch (e) {
    console.error('[GIST WRITE ERROR]', e.message);
  }
}

// ─── PERSISTÊNCIA LOCAL ──────────────────────────────────────────────────────

function loadData() {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return {}; }
}

// Salva localmente e atualiza o Gist em background
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  gistWrite(data).catch(e => console.error('[GIST ASYNC]', e.message));
}

// Salva apenas localmente — usado no restore para não sobrescrever o Gist com dados antigos
function saveDataLocal(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// No startup: se o arquivo local estiver vazio, restaura do Gist (pós-redeploy)
async function initData() {
  const local = loadData();
  if (Object.keys(local).length > 0) {
    console.log('[INIT] Arquivo local ok —', Object.keys(local).length, 'chaves');
    return;
  }
  console.log('[INIT] Local vazio — tentando restaurar do Gist...');
  const gistData = await gistRead();
  if (gistData && Object.keys(gistData).length > 0) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(gistData, null, 2));
    console.log('[INIT] ✅ Dados restaurados do Gist');
  } else {
    console.log('[INIT] Gist vazio ou inacessível — iniciando do zero');
  }
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

// Retorna a chave da semana ISO atual (ex: "semana-2026-22")
function getWeekKey(date) {
  const d = new Date(date || new Date());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `semana-${d.getFullYear()}-${String(week).padStart(2, '0')}`;
}

function getSprintKey() { return 'sprint-3-2026'; }
function generateId()   { return Date.now().toString(36) + Math.random().toString(36).substr(2, 4); }
function formatDate(iso){ return new Date(iso).toLocaleDateString('pt-BR'); }
function formatTime(iso){ return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }

function getDayLabel(date) {
  return ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][(date || new Date()).getDay()];
}

function statusEmoji(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('conclu') || s.includes('done'))     return '✅';
  if (s.includes('andamento') || s.includes('progress')) return '🔄';
  if (s.includes('lise') || s.includes('review'))     return '🔍';
  if (s.includes('fazer'))                             return '📋';
  return '❓';
}

const fmtDate     = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
const diasDesde   = iso => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 999;
const linkifyJira = txt => txt.replace(/\b(SCRUM-\d+)\b/g, `[$1](https://${JIRA_DOMAIN}/browse/$1)`);
const jiraUrl     = key => `https://${JIRA_DOMAIN}/browse/${key}`;

// Migra impedimentos abertos de semanas anteriores para a semana atual (arrastados)
function migrarImpedimentosAbertos(data) {
  const semanaAtual = getWeekKey();
  if (!data[semanaAtual]) data[semanaAtual] = {};

  for (const chave of Object.keys(data).filter(k => k.startsWith('semana-') && k !== semanaAtual)) {
    for (const [uid, dev] of Object.entries(data[chave])) {
      if (uid.startsWith('_')) continue;
      const abertos = (dev.impedimentos || []).filter(i => !i.resolvido && !i.migrado);
      if (!abertos.length) continue;

      if (!data[semanaAtual][uid]) data[semanaAtual][uid] = { nome: dev.nome, impedimentos: [] };

      for (const imp of abertos) {
        imp.migrado = true;
        const jaCopiei = data[semanaAtual][uid].impedimentos.some(i => i.id === imp.id);
        if (!jaCopiei) data[semanaAtual][uid].impedimentos.push({ ...imp, migrado: false, arrastado: true });
      }
    }
  }
  saveData(data);
}

// ─── JIRA (VIA PROXY N8N) ────────────────────────────────────────────────────
// O bot não chama o Jira diretamente — usa o n8n como proxy intermediário.
// Isso foi necessário porque chamadas diretas ao Jira apresentavam timeout no Render.

const jiraProxy = async (tipo, extra) => {
  try {
    const url = N8N_PROXY + '?tipo=' + tipo + (extra ? '&extra=' + encodeURIComponent(extra) : '');
    console.log('[PROXY]', url);
    const res = await axios.get(url, { timeout: 20000, validateStatus: () => true });
    return res.data || {};
  } catch (e) {
    console.log('[PROXY ERROR]', e.message);
    return { __error: e.message };
  }
};

let _sprintCache = null, _sprintCacheTime = 0;

async function getSprintIssues(filter) {
  const now = Date.now();
  if (_sprintCache && now - _sprintCacheTime < 60000) {
    const issues = filter ? filter(_sprintCache) : _sprintCache;
    return { issues };
  }
  const res = await jiraProxy('sprint');
  _sprintCache = res.issues || [];
  _sprintCacheTime = now;
  return { issues: filter ? filter(_sprintCache) : _sprintCache };
}

async function jiraGet(url) {
  const keyMatch = url.match(/\/issue\/([A-Z]+-\d+)/);
  if (keyMatch) {
    const res = await jiraProxy('changelog', keyMatch[1]);
    return url.includes('/changelog') ? (res.changelog || {}) : (res.issue || {});
  }
  if (url.includes('/backlog'))        return jiraProxy('backlog');
  if (url.includes('labels'))          return jiraProxy('devops');
  if (url.includes('sprint is EMPTY')) return jiraProxy('semsprint');
  return jiraProxy('sprint');
}

async function jiraSearch(jql, _fields, maxResults = 50) {
  if (jql.includes('sprint is EMPTY')) return jiraProxy('semsprint');
  if (jql.includes('labels'))          return jiraProxy('devops');

  if (jql.includes('sprint')) {
    let filter = null;
    if (jql.match(/assignee\s+is\s+EMPTY/i))   filter = a => a.filter(i => !i.fields.assignee);
    if (jql.includes('"Em Andamento"'))          filter = a => a.filter(i => (i.fields.status?.name || '').includes('Andamento'));
    const updM = jql.match(/updated[^"]*"(\d{4}-\d{2}-\d{2})"/);
    if (updM) { const lim = new Date(updM[1]); filter = a => a.filter(i => new Date(i.fields.updated) <= lim); }
    const accM = jql.match(/assignee\s*=\s*"([^"]+)"/);
    if (accM) { const acc = accM[1]; filter = a => a.filter(i => i.fields.assignee?.accountId === acc); }
    const res = await getSprintIssues(filter);
    return { issues: (res.issues || []).slice(0, maxResults) };
  }
  return jiraProxy('sprint');
}


// ─── GITLAB (DIRETO — usado para releases/deploy) ────────────────────────────

async function gitlabGetReleases() {
  if (!GITLAB_TOKEN) return [];
  const headers = { 'PRIVATE-TOKEN': GITLAB_TOKEN };
  const allReleases = [];
  for (const slug of GITLAB_REPOS) {
    try {
      const enc = encodeURIComponent(slug);
      const res = await axios.get(`https://gitlab.com/api/v4/projects/${enc}/releases?per_page=10`, {
        headers, timeout: 10000,
      });
      const releases = Array.isArray(res.data) ? res.data : [];
      const repoName = slug.split('/')[1].replace('-tecsus', '').replace('api-4-sem', 'principal');
      for (const rel of releases) {
        allReleases.push({
          repo: repoName,
          slug,
          tag: rel.tag_name,
          name: rel.name || rel.tag_name,
          description: (rel.description || '').substring(0, 200),
          createdAt: rel.created_at,
          author: rel.author?.name || rel.author?.username || '—',
          url: rel._links?.self || `https://gitlab.com/${slug}/-/releases/${rel.tag_name}`,
        });
      }
    } catch (e) {
      console.error(`[GITLAB] Erro ao buscar releases de ${slug}:`, e.message);
    }
  }
  allReleases.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return allReleases;
}

// ─── DAILY AUTOMÁTICA ────────────────────────────────────────────────────────

let dailyAtiva = null;

async function getTodosMembros(guild) {
  await guild.members.fetch();
  return guild.members.cache.filter(m => !m.user.bot);
}

function getNomeExibicao(member) {
  return member.nickname || member.user.displayName || member.user.username;
}

async function iniciarDaily(guild, membrosPresentes) {
  const agora = new Date().toISOString();
  dailyAtiva = {
    inicio: agora,
    presentes: new Set(membrosPresentes.map(m => m.id)),
    presentesNomes: new Map(membrosPresentes.map(m => [m.id, getNomeExibicao(m)])),
  };

  const data = loadData(), semana = getWeekKey();
  if (!data[semana]) data[semana] = {};
  if (!data[semana]._dailys) data[semana]._dailys = [];
  saveData(data);

  const canal = await guild.channels.fetch(CANAL_DAILY_LOG).catch(() => null);
  if (!canal) return;

  await canal.send({ embeds: [new EmbedBuilder()
    .setColor(0x2E5FAC)
    .setTitle('📡 Daily Iniciada Automaticamente')
    .addFields(
      { name: '🕐 Início',    value: formatTime(agora),                                        inline: true },
      { name: '📅 Data',      value: formatDate(agora),                                        inline: true },
      { name: '👥 No canal',  value: membrosPresentes.length + ' membros',                     inline: true },
      { name: '✅ Presentes', value: membrosPresentes.map(m => getNomeExibicao(m)).join(', ') },
    )
    .setFooter({ text: 'O registro será finalizado quando todos saírem do canal' })
    .setTimestamp(),
  ]});
}

async function adicionarMembroDaily(guild, member) {
  if (!dailyAtiva || dailyAtiva.presentes.has(member.id)) return;
  dailyAtiva.presentes.add(member.id);
  dailyAtiva.presentesNomes.set(member.id, getNomeExibicao(member));

  const canal = await guild.channels.fetch(CANAL_DAILY_LOG).catch(() => null);
  if (!canal) return;

  await canal.send({ embeds: [new EmbedBuilder()
    .setColor(0x1565C0)
    .setTitle('➕ Membro entrou na Daily')
    .setDescription(`**${getNomeExibicao(member)}** entrou e foi registrado como presente.`)
    .setTimestamp(),
  ]});
}

async function finalizarDaily(guild) {
  if (!dailyAtiva) return;

  const agora  = new Date();
  const inicio = new Date(dailyAtiva.inicio);
  const min    = Math.floor((agora - inicio) / 60000);
  const seg    = Math.floor(((agora - inicio) % 60000) / 1000);
  const todos  = await getTodosMembros(guild);
  const ausentes = todos.filter(m => !dailyAtiva.presentes.has(m.id));

  const data   = loadData();
  const semana = getWeekKey(inicio);
  const sprint = getSprintKey();
  if (!data[semana]) data[semana] = {};
  if (!data[semana]._dailys) data[semana]._dailys = [];
  if (!data[sprint]) data[sprint] = {};
  if (!data[sprint]._dailys) data[sprint]._dailys = [];

  const reg = {
    id: generateId(),
    data: inicio.toISOString(),
    diaSemana: getDayLabel(inicio),
    inicio: dailyAtiva.inicio,
    fim: agora.toISOString(),
    duracaoMin: min,
    presentes: [...dailyAtiva.presentesNomes.entries()].map(([id, nome]) => ({ id, nome })),
    ausentes: ausentes.map(m => ({ id: m.id, nome: getNomeExibicao(m) })),
    totalMembros: todos.size,
  };

  data[semana]._dailys.push(reg);
  data[sprint]._dailys.push(reg);
  saveData(data);
  dailyAtiva = null;

  const canal = await guild.channels.fetch(CANAL_DAILY_LOG).catch(() => null);
  if (!canal) return;

  const presNomes = reg.presentes.map(p => p.nome).join(', ');
  const ausNomes  = ausentes.map(m => getNomeExibicao(m)).join(', ') || 'Nenhum — 100% de presença! 🎉';

  await canal.send({ embeds: [new EmbedBuilder()
    .setColor(ausentes.length === 0 ? 0x2E7D32 : 0xF57F17)
    .setTitle('📋 Daily Finalizada')
    .addFields(
      { name: '🕐 Início',                      value: formatTime(reg.inicio),                              inline: true },
      { name: '🕑 Fim',                          value: formatTime(reg.fim),                                inline: true },
      { name: '⏱️ Duração',                      value: (min > 0 ? min + 'min ' : '') + seg + 's',          inline: true },
      { name: `✅ Presentes (${reg.presentes.length})`, value: presNomes },
      { name: `❌ Ausentes (${ausentes.length})`,       value: ausNomes  },
    )
    .setFooter({ text: `QA DevOps Bot · ${getDayLabel(inicio)}, ${formatDate(inicio.toISOString())}` })
    .setTimestamp(),
  ]});
}

// ─── LEMBRETE E RESUMO SEMANAL ───────────────────────────────────────────────

function agendarLembreteDiario() {
  function msAteProximo7h() {
    const agora  = new Date();
    const alvo   = new Date();
    alvo.setHours(7, 0, 0, 0);
    if (agora >= alvo) alvo.setDate(alvo.getDate() + 1);
    return alvo - agora;
  }

  function tick() {
    const dia = new Date().getDay();
    if (dia >= 1 && dia <= 5) enviarLembrete();
    setTimeout(tick, msAteProximo7h());
  }

  setTimeout(tick, msAteProximo7h());
  console.log('⏰ Lembrete diário agendado');
}

async function enviarLembrete() {
  const canal = await client.channels.fetch(CANAL_REMINDER).catch(() => null);
  if (!canal) return;

  const data   = loadData();
  migrarImpedimentosAbertos(data);
  const semana = getWeekKey();
  const devs   = data[semana] || {};
  let ab = 0, re = 0, ar = 0;

  for (const [k, dev] of Object.entries(devs)) {
    if (k.startsWith('_')) continue;
    ab += (dev.impedimentos || []).filter(i => !i.resolvido).length;
    re += (dev.impedimentos || []).filter(i =>  i.resolvido).length;
    ar += (dev.impedimentos || []).filter(i => !i.resolvido && i.arrastado).length;
  }

  const totalDailys = (data[semana]?._dailys || []).length;
  let desc = `Bom dia, time! 👋\n\n📡 A daily será registrada **automaticamente** quando ${DAILY_MIN}+ membros entrarem no canal de voz **Daily**.\n\n📊 Esta semana:\n🗓️ Dailys realizadas: **${totalDailys}** (mínimo: **${DAILY_MIN}/semana**) · 🔴 Impedimentos abertos: **${ab}** · ✅ Resolvidos: **${re}**`;
  if (ar > 0) desc += `\n⚠️ **${ar}** impedimento(s) arrastado(s) da semana anterior ainda em aberto`;
  desc += '\n\nSe tiver algum impedimento:\n> **/impedimento** `<descrição>` `[tarefa: SCRUM-XX]`';

  await canal.send({ embeds: [new EmbedBuilder()
    .setColor(0x2E5FAC)
    .setTitle(`📋 Daily Check — ${getDayLabel()}`)
    .setDescription(desc)
    .setFooter({ text: 'QA DevOps Bot · The-Devs · Tecsus' })
    .setTimestamp(),
  ]});

  if (new Date().getDay() === 1) await enviarResumoSemanalAnterior();
}

async function enviarResumoSemanalAnterior() {
  const canal = await client.channels.fetch(CANAL_DAILY_LOG).catch(() => null);
  if (!canal) return;

  const semanaPassada = new Date();
  semanaPassada.setDate(semanaPassada.getDate() - 7);
  const data   = loadData();
  const dailys = data[getWeekKey(semanaPassada)]?._dailys || [];

  if (!dailys.length) {
    await canal.send({ embeds: [new EmbedBuilder()
      .setColor(0xB71C1C)
      .setTitle('📊 Resumo da Semana Anterior')
      .setDescription('❌ Nenhuma daily foi registrada na semana passada.')
      .setTimestamp(),
    ]});
    return;
  }

  const presencaPorNome = new Map();
  for (const d of dailys) {
    for (const p of d.presentes) { presencaPorNome.set(p.nome, (presencaPorNome.get(p.nome) || 0) + 1); }
    for (const a of d.ausentes)  { if (!presencaPorNome.has(a.nome)) presencaPorNome.set(a.nome, 0); }
  }

  const total = dailys.length;
  let porDia  = '';
  for (const dia of ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta']) {
    const d = dailys.find(x => x.diaSemana === dia);
    if (d) {
      const pct = Math.round(d.presentes.length / d.totalMembros * 100);
      porDia += `**${dia}:** ✅ ${d.presentes.length}/${d.totalMembros} (${pct}%) — ${d.duracaoMin}min`;
      if (d.ausentes.length) porDia += ' — ❌ ' + d.ausentes.map(a => a.nome).join(', ');
    } else {
      porDia += `**${dia}:** ❌ Não realizada`;
    }
    porDia += '\n';
  }

  let presIndiv = '';
  for (const [nome, n] of [...presencaPorNome.entries()].sort((a, b) => b[1] - a[1])) {
    presIndiv += nome.padEnd(12) + ' ' + '█'.repeat(n) + '░'.repeat(Math.max(0, total - n)) + ` ${n}/${total}\n`;
  }

  await canal.send({ embeds: [new EmbedBuilder()
    .setColor(total >= DAILY_MIN ? 0x2E7D32 : 0xB71C1C)
    .setTitle('📊 Resumo de Presença — Semana Anterior')
    .addFields(
      { name: (total >= DAILY_MIN ? '✅' : '⚠️') + ' Dailys realizadas', value: `**${total}/semana** (mínimo: ${DAILY_MIN}) — ${total >= DAILY_MIN ? 'atingido ✅' : 'NÃO atingido ❌'}` },
      { name: '📅 Por dia',              value: porDia || '—' },
      { name: '👤 Presença individual',  value: '```\n' + presIndiv + '```' },
    )
    .setFooter({ text: 'QA DevOps Bot · The-Devs · Tecsus' })
    .setTimestamp(),
  ]});
}

// ─── REGISTRO DE SLASH COMMANDS ──────────────────────────────────────────────

async function registerCommands() {
  const str = o => o.setRequired(true);
  const opt = o => o.setRequired(false);

  const commands = [
    new SlashCommandBuilder().setName('impedimento').setDescription('Registrar um impedimento ou dificuldade')
      .addStringOption(o => str(o).setName('descricao').setDescription('Descreva o impedimento'))
      .addStringOption(o => opt(o).setName('tarefa').setDescription('Issue relacionada (ex: SCRUM-91)')),
    new SlashCommandBuilder().setName('impedimento-resolvido').setDescription('Marcar um impedimento como resolvido')
      .addStringOption(o => str(o).setName('id').setDescription('ID do impedimento')),
    new SlashCommandBuilder().setName('meus-impedimentos').setDescription('Ver seus impedimentos desta sprint'),
    new SlashCommandBuilder().setName('impedimentos-time').setDescription('Ver todos os impedimentos do time esta semana'),
    new SlashCommandBuilder().setName('limpar-resolvidos-semana').setDescription('Remove impedimentos resolvidos da semana atual'),
    new SlashCommandBuilder().setName('limpar-resolvidos-tudo').setDescription('Remove impedimentos resolvidos de todas as semanas'),
    new SlashCommandBuilder().setName('limpar-impedimentos-semana').setDescription('Remove TODOS os impedimentos da semana atual'),
    new SlashCommandBuilder().setName('limpar-impedimentos-tudo').setDescription('Remove TODOS os impedimentos de todas as semanas'),
    new SlashCommandBuilder().setName('daily-status').setDescription('Status das dailys da semana atual'),
    new SlashCommandBuilder().setName('backup-dados').setDescription('Exporta o JSON de dados do bot como arquivo'),
    new SlashCommandBuilder().setName('restaurar-dados').setDescription('Restaura os dados do Gist sem precisar de redeploy'),
    new SlashCommandBuilder().setName('backlog').setDescription('Lista as issues do backlog sem sprint'),
    new SlashCommandBuilder().setName('issues-sem-responsavel').setDescription('Issues da sprint sem ninguém atribuído'),
    new SlashCommandBuilder().setName('issues-devops').setDescription('Issues com a label devops'),
    new SlashCommandBuilder().setName('issues-paradas').setDescription(`Issues Em Andamento sem atualização há mais de ${JIRA_DIAS_PARADA} dias`),
    new SlashCommandBuilder().setName('changelog-issue').setDescription('Histórico de uma issue específica')
      .addStringOption(o => str(o).setName('issue').setDescription('Chave ou número (ex: SCRUM-85 ou 85)').setAutocomplete(true)),
    new SlashCommandBuilder().setName('resumo-jira').setDescription('Relatório completo da sprint'),
    new SlashCommandBuilder().setName('issue-responsavel').setDescription('Issues da sprint de um membro')
      .addStringOption(o => str(o).setName('membro').setDescription('Selecione o membro').addChoices(
        { name: 'Otávio Vianna Lima',        value: '61bae2acf19b53006a9cdc45' },
        { name: 'Issami Umeoka',             value: '712020:84525927-9631-4c24-adfa-bee26d5c0a26' },
        { name: 'Guilherme Almeida',         value: '712020:1dadb4c4-bc15-4454-aa9c-29e7d4eea8c3' },
        { name: 'Guilherme Camargo',         value: '712020:1c63f1bf-e0d5-4e90-a3b1-52c6af494f75' },
        { name: 'Gustavo Camargo',           value: '712020:a81b9d69-9e0e-45ed-b0ba-2595fb50212b' },
        { name: 'Tiago Freitas',             value: '712020:90d6d35f-ecb6-43b7-b81f-6f27fb768613' },
        { name: 'Matheus de Castro',         value: '712020:fc3f9028-2b3c-44eb-8268-67eafe4e1d3b' },
      )),
    new SlashCommandBuilder().setName('confluence').setDescription('Acessa páginas do Confluence')
      .addStringOption(o => str(o).setName('pagina').setDescription('Selecione a página').addChoices(
        { name: '📖 User Stories',            value: 'confluence-userstories' },
        { name: '📋 Requisitos do Projeto',   value: 'confluence-requisitos'  },
        { name: '⚖️ Regras de Negócio',       value: 'confluence-regras'      },
        { name: '📦 Backlog do Produto',      value: 'confluence-backlog'     },
        { name: '📑 Backlog Sprint 1',        value: 'confluence-sprint1'     },
        { name: '📑 Backlog Sprint 2',        value: 'confluence-sprint2'     },
        { name: '📑 Backlog Sprint 3',        value: 'confluence-sprint3'     },
        { name: '📂 Listar todas as páginas', value: 'confluence-list'        },
      )),
    new SlashCommandBuilder().setName('user-stories').setDescription('User stories do projeto (Confluence)'),
    new SlashCommandBuilder().setName('requisitos').setDescription('Requisitos do projeto (Confluence)'),
    new SlashCommandBuilder().setName('regras-de-negocio').setDescription('Regras de negócio do projeto (Confluence)'),
    new SlashCommandBuilder().setName('backlog-produto').setDescription('Backlog do produto (Confluence)'),
    new SlashCommandBuilder().setName('ultimo-deploy').setDescription('Mostra o último release/deploy registrado no GitLab'),
    new SlashCommandBuilder().setName('historico-deploy').setDescription('Lista todos os releases/deploys registrados no GitLab'),
    new SlashCommandBuilder().setName('historico-dailys').setDescription('Todas as dailys registradas, separadas por semana'),
    new SlashCommandBuilder().setName('historico-impedimentos').setDescription('Todos os impedimentos registrados, separados por semana'),
    new SlashCommandBuilder().setName('ajuda').setDescription('Lista todos os comandos disponíveis'),
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Slash commands registrados');
  } catch (e) {
    console.error('❌ Erro ao registrar commands:', e);
  }
}

// ─── CLIENTE DISCORD ─────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild  = newState.guild || oldState.guild;
  const member = newState.member || oldState.member;
  if (member?.user?.bot) return;

  const oldCh = (oldState.channelId || '').trim();
  const newCh = (newState.channelId || '').trim();
  const entrou = newCh === CANAL_DAILY_VOZ && oldCh !== CANAL_DAILY_VOZ;
  const saiu   = oldCh === CANAL_DAILY_VOZ && newCh !== CANAL_DAILY_VOZ;

  console.log(`[VOZ] ${getNomeExibicao(member)} | ${oldCh} → ${newCh}`);

  if (entrou) {
    const canal = await guild.channels.fetch(CANAL_DAILY_VOZ).catch(() => null);
    if (!canal) return;
    const membros = canal.members.filter(m => !m.user.bot);
    console.log('[VOZ] Membros no canal:', membros.size, '| mínimo:', DAILY_MIN);
    if (!dailyAtiva && membros.size >= DAILY_MIN) await iniciarDaily(guild, [...membros.values()]);
    else if (dailyAtiva) await adicionarMembroDaily(guild, member);
  }

  if (saiu && dailyAtiva) {
    const canal = await guild.channels.fetch(CANAL_DAILY_VOZ).catch(() => null);
    if (!canal) return;
    if (canal.members.filter(m => !m.user.bot).size === 0) await finalizarDaily(guild);
  }
});

client.on('error', err => { if (err?.code !== 10062) console.error('[CLIENT ERROR]', err?.message || err); });
process.on('unhandledRejection', err => { if (err?.code !== 10062) console.error('[UNHANDLED]', err?.message || err); });
process.on('uncaughtException',  err => { if (err?.code !== 10062) console.error('[UNCAUGHT]',  err?.message || err); });

client.once('ready', async () => {
  console.log('✅ Bot online:', client.user.tag);
  await initData();
  await registerCommands();
  agendarLembreteDiario();
  setTimeout(() => getSprintIssues(null).catch(() => {}), 3000);
});

// ─── HANDLERS DE INTERAÇÃO ───────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {
  // Autocomplete para /changelog-issue
  if (interaction.isAutocomplete()) {
    if (interaction.commandName !== 'changelog-issue') return;
    try {
      const focused  = interaction.options.getFocused().toUpperCase().replace(/[^A-Z0-9-]/g, '');
      const query    = focused.replace('SCRUM-', '');
      const res      = await getSprintIssues(null);
      const filtered = (res.issues || [])
        .filter(i => !focused || i.key.includes(focused) || i.key.replace('SCRUM-','').startsWith(query) || i.fields.summary.toLowerCase().includes(focused.toLowerCase()))
        .slice(0, 25)
        .map(i => ({ name: `${i.key} — ${i.fields.summary.substring(0, 80)}`, value: i.key }));
      await interaction.respond(filtered);
    } catch { try { await interaction.respond([]); } catch {} }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, user } = interaction;
  const data   = loadData();
  const semana = getWeekKey();
  const sprint = getSprintKey();

  // Migração de impedimentos não roda no restore para evitar sobrescrever o Gist
  if (commandName !== 'restaurar-dados') migrarImpedimentosAbertos(data);

  if (!data[semana]) data[semana] = {};
  if (!data[semana][user.id]) data[semana][user.id] = { nome: user.username, impedimentos: [] };
  if (!data[sprint]) data[sprint] = {};
  if (!data[sprint][user.id]) data[sprint][user.id] = { nome: user.username, impedimentos: [] };

  const defer = async () => {
    try { await interaction.deferReply(); return true; }
    catch (e) { if (e?.code === 10062) return false; throw e; }
  };

  // ── /impedimento ─────────────────────────────────────────────────────────
  if (commandName === 'impedimento') {
    const descricao = interaction.options.getString('descricao');
    const tarefa    = interaction.options.getString('tarefa') || null;
    const id        = generateId();
    const agora     = new Date().toISOString();
    const novo      = { id, descricao, tarefa, data: agora, resolvido: false, dataResolucao: null, arrastado: false };

    data[semana][user.id].impedimentos.push(novo);
    data[sprint][user.id].impedimentos.push(novo);
    saveData(data);

    const fields = [
      { name: '👤 Dev',       value: user.username,           inline: true },
      { name: '🆔 ID',        value: `\`${id}\``,             inline: true },
      { name: '📅 Data',      value: formatDate(agora),       inline: true },
      { name: '📝 Descrição', value: linkifyJira(descricao)               },
      { name: '🔴 Status',    value: 'Aberto',                inline: true },
    ];
    if (tarefa) fields.splice(4, 0, { name: '🎯 Tarefa', value: tarefa, inline: true });

    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(0xE65100)
      .setTitle('⚠️ Impedimento Registrado')
      .addFields(fields)
      .setFooter({ text: 'Use /impedimento-resolvido <id> quando resolver' })
      .setTimestamp(),
    ]});
  }

  // ── /impedimento-resolvido ───────────────────────────────────────────────
  else if (commandName === 'impedimento-resolvido') {
    const idBuscado = interaction.options.getString('id');
    const agora     = new Date().toISOString();
    let resolvido   = false;
    let descricao   = '';

    for (const chave of [semana, sprint]) {
      const dev = data[chave]?.[user.id];
      if (!dev) continue;
      const imp = dev.impedimentos.find(i => i.id === idBuscado);
      if (imp && !imp.resolvido) {
        imp.resolvido = true;
        imp.dataResolucao = agora;
        resolvido = true;
        descricao = imp.descricao;
      }
    }

    if (!resolvido) {
      await interaction.reply({ content: `❌ Impedimento \`${idBuscado}\` não encontrado ou já resolvido.`, ephemeral: true });
      return;
    }
    saveData(data);
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(0x2E7D32)
      .setTitle('✅ Impedimento Desbloqueado!')
      .setDescription(`**${user.username}** resolveu um impedimento 🎉`)
      .addFields(
        { name: '🆔 ID',           value: `\`${idBuscado}\``,  inline: true },
        { name: '📅 Resolvido em', value: formatDate(agora),   inline: true },
        { name: '📝 Era',          value: descricao || '—'                  },
      )
      .setTimestamp(),
    ]});
  }

  // ── /meus-impedimentos ──────────────────────────────────────────────────
  else if (commandName === 'meus-impedimentos') {
    const lista   = data[semana]?.[user.id]?.impedimentos || [];
    const abertos = lista.filter(i => !i.resolvido);
    const resolvidos = lista.filter(i => i.resolvido);

    if (!lista.length) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2E7D32).setTitle(`✅ ${user.username} não tem impedimentos esta semana`).setTimestamp()] });
      return;
    }

    let txt = '';
    if (abertos.length) {
      txt += '**🔴 Abertos:**\n';
      for (const i of abertos) {
        txt += `• \`${i.id}\` — ${linkifyJira(i.descricao)}`;
        if (i.tarefa) txt += ` *([${i.tarefa}](${jiraUrl(i.tarefa)}))*`;
        if (i.arrastado) txt += ' *(arrastado da semana anterior)*';
        txt += `\n  📅 ${formatDate(i.data)}\n`;
      }
    }
    if (resolvidos.length) {
      txt += '\n**✅ Resolvidos:**\n';
      for (const i of resolvidos) {
        txt += `• ~~${i.descricao}~~`;
        if (i.tarefa) txt += ` *(${i.tarefa})*`;
        txt += ` — ${formatDate(i.dataResolucao)}\n`;
      }
    }

    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(0x2E5FAC)
      .setTitle(`📋 Impedimentos de ${user.username} — Esta Semana`)
      .setDescription(txt)
      .setFooter({ text: `Total: ${lista.length} | Abertos: ${abertos.length} | Resolvidos: ${resolvidos.length}` })
      .setTimestamp(),
    ]});
  }

  // ── /impedimentos-time ──────────────────────────────────────────────────
  else if (commandName === 'impedimentos-time') {
    const uids = Object.keys(data[semana] || {}).filter(k => !k.startsWith('_'));

    if (!uids.length) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2E7D32).setTitle('🎉 Time sem impedimentos esta semana!').setDescription('Ótimo ritmo!').setTimestamp()] });
      return;
    }

    const hoje = new Date();
    const ini  = new Date(hoje); ini.setDate(hoje.getDate() - (hoje.getDay() === 0 ? 6 : hoje.getDay() - 1));
    const fim  = new Date(ini);  fim.setDate(ini.getDate() + 4);

    let totalAbertos = 0, totalResolvidos = 0, totalArrastados = 0;
    const fields = [];

    for (const uid of uids) {
      const dev      = data[semana][uid];
      const abertos  = dev.impedimentos.filter(i => !i.resolvido);
      const resolvs  = dev.impedimentos.filter(i =>  i.resolvido);
      const arrastados = abertos.filter(i => i.arrastado);
      totalAbertos   += abertos.length;
      totalResolvidos += resolvs.length;
      totalArrastados += arrastados.length;

      let val = '';
      for (const i of abertos) {
        val += `🔴 \`${i.id}\` ${linkifyJira(i.descricao)}`;
        if (i.tarefa)   val += ` *([${i.tarefa}](${jiraUrl(i.tarefa)}))*`;
        if (i.arrastado) val += ' ⚠️*(anterior)*';
        val += ` — ${formatDate(i.data)}\n`;
      }
      for (const i of resolvs) {
        val += `✅ ~~${i.descricao}~~`;
        if (i.tarefa) val += ` *(${i.tarefa})*`;
        val += ` — ${formatDate(i.dataResolucao)}\n`;
      }
      if (!val) val = '✅ Nenhum impedimento esta semana';
      fields.push({ name: `👤 ${dev.nome} (${abertos.length} aberto · ${resolvs.length} resolvido)`, value: val.substring(0, 1020), inline: false });
    }

    let desc = `📅 **${formatDate(ini.toISOString())} – ${formatDate(fim.toISOString())}**\n🔴 Abertos: **${totalAbertos}** · ✅ Resolvidos: **${totalResolvidos}**`;
    if (totalArrastados > 0) desc += `\n⚠️ **${totalArrastados}** arrastado(s) da semana anterior`;

    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(totalAbertos > 0 ? 0xE65100 : 0x2E7D32)
      .setTitle('📊 Impedimentos do Time — Esta Semana')
      .setDescription(desc)
      .addFields(fields)
      .setFooter({ text: 'QA DevOps Bot · The-Devs · Tecsus' })
      .setTimestamp(),
    ]});
  }

  // ── /daily-status ────────────────────────────────────────────────────────
  else if (commandName === 'daily-status') {
    const dailys = data[semana]?._dailys || [];
    const hoje   = new Date();
    const diaAtual = hoje.getDay(); // 0=Dom, 1=Seg ... 6=Sab
    const semanaEncerrada = diaAtual === 0 || diaAtual === 6;

    const inicioSemana = new Date(hoje);
    inicioSemana.setDate(hoje.getDate() - (diaAtual === 0 ? 6 : diaAtual - 1));
    inicioSemana.setHours(0, 0, 0, 0);
    const fimSemana = new Date(inicioSemana);
    fimSemana.setDate(inicioSemana.getDate() + 4);

    const total    = dailys.length;
    const atingido = total >= DAILY_MIN;
    const barra    = '█'.repeat(Math.min(total, DAILY_MIN)) + '░'.repeat(Math.max(0, DAILY_MIN - total));

    let porDia = '';
    for (const dia of ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta']) {
      const d    = dailys.find(x => x.diaSemana === dia);
      const diaN = ['Segunda','Terça','Quarta','Quinta','Sexta'].indexOf(dia) + 1;

      if (d) {
        porDia += `✅ **${dia}** — ${d.presentes.length}/${d.totalMembros} presentes · ${d.duracaoMin}min`;
        if (d.ausentes.length) porDia += ' · ❌ ' + d.ausentes.map(a => a.nome).join(', ');
      } else if (semanaEncerrada || diaN < diaAtual) {
        porDia += `❌ **${dia}** — Não realizada`;
      } else if (diaN === diaAtual) {
        porDia += dailyAtiva ? `🔴 **${dia}** — **Em andamento agora!**` : `⏳ **${dia}** — Aguardando...`;
      } else {
        porDia += `⬜ **${dia}** — Ainda não chegou`;
      }
      porDia += '\n';
    }

    const presencaPorNome = new Map();
    for (const d of dailys) {
      for (const p of d.presentes) presencaPorNome.set(p.nome, (presencaPorNome.get(p.nome) || 0) + 1);
    }
    let presIndiv = '';
    for (const [nome, n] of [...presencaPorNome.entries()].sort((a, b) => b[1] - a[1])) {
      presIndiv += `\`${nome.padEnd(14)}\` ${'█'.repeat(n)}${'░'.repeat(Math.max(0, total - n))} ${n}/${total}\n`;
    }

    const embed = new EmbedBuilder()
      .setColor(atingido ? 0x2E7D32 : total > 0 ? 0xF57F17 : 0xB71C1C)
      .setTitle(`📡 Status das Dailys — ${formatDate(inicioSemana.toISOString())} a ${formatDate(fimSemana.toISOString())}`)
      .setDescription(`${atingido ? '✅' : '⏳'} **${total}/${DAILY_MIN} dailys mínimas** ${barra}${atingido ? ' — Meta atingida!' : ' — Meta ainda não atingida'}`)
      .addFields({ name: '📅 Por dia', value: porDia || '—' });

    if (presIndiv) embed.addFields({ name: '👤 Presença individual', value: presIndiv });
    if (dailyAtiva) embed.addFields({ name: '🔴 Daily em andamento!', value: `Iniciada às ${formatTime(dailyAtiva.inicio)} · ${dailyAtiva.presentes.size} presentes`, inline: false });

    embed.setFooter({ text: `QA DevOps Bot · The-Devs · Mínimo: ${DAILY_MIN} dailys/semana` }).setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  // ── Limpeza de impedimentos ──────────────────────────────────────────────
  else if (commandName === 'limpar-resolvidos-semana') {
    let n = 0;
    for (const [k, dev] of Object.entries(data[semana] || {})) {
      if (k.startsWith('_') || !dev.impedimentos) continue;
      const antes = dev.impedimentos.length;
      dev.impedimentos = dev.impedimentos.filter(i => !i.resolvido);
      n += antes - dev.impedimentos.length;
    }
    saveData(data);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2E7D32).setTitle('🧹 Resolvidos removidos — Semana atual').setDescription(`**${n}** impedimento(s) removido(s).`).setTimestamp()] });
  }

  else if (commandName === 'limpar-resolvidos-tudo') {
    let n = 0;
    for (const ch of Object.keys(data)) {
      for (const [k, dev] of Object.entries(data[ch] || {})) {
        if (k.startsWith('_') || !dev?.impedimentos) continue;
        const antes = dev.impedimentos.length;
        dev.impedimentos = dev.impedimentos.filter(i => !i.resolvido);
        n += antes - dev.impedimentos.length;
      }
    }
    saveData(data);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2E7D32).setTitle('🧹 Resolvidos removidos — Todas as semanas').setDescription(`**${n}** impedimento(s) removido(s).`).setTimestamp()] });
  }

  else if (commandName === 'limpar-impedimentos-semana') {
    let n = 0;
    for (const [k, dev] of Object.entries(data[semana] || {})) {
      if (k.startsWith('_') || !dev.impedimentos) continue;
      n += dev.impedimentos.length;
      dev.impedimentos = [];
    }
    saveData(data);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xB71C1C).setTitle('🗑️ Impedimentos removidos — Semana atual').setDescription(`**${n}** impedimento(s) removido(s).`).setTimestamp()] });
  }

  else if (commandName === 'limpar-impedimentos-tudo') {
    let n = 0;
    for (const ch of Object.keys(data)) {
      for (const [k, dev] of Object.entries(data[ch] || {})) {
        if (k.startsWith('_') || !dev?.impedimentos) continue;
        n += dev.impedimentos.length;
        dev.impedimentos = [];
      }
    }
    saveData(data);
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xB71C1C).setTitle('🗑️ Impedimentos removidos — Todo o histórico').setDescription(`**${n}** impedimento(s) removido(s).`).setTimestamp()] });
  }

  // ── Jira ─────────────────────────────────────────────────────────────────
  else if (commandName === 'backlog') {
    if (!await defer()) return;
    const res    = await jiraProxy('backlog');
    const issues = res.issues || [];
    if (!issues.length) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2E7D32).setTitle('✅ Backlog vazio').setDescription('Nenhuma user story no backlog.').setTimestamp()] });
      return;
    }
    const txt = issues.map(i => `[${i.key}](${jiraUrl(i.key)}) **${i.fields.summary.substring(0, 55)}**\n  ↳ ${i.fields.issuetype?.name || 'História'}`).join('\n');
    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(0x2E5FAC)
      .setTitle(`📋 Backlog — ${issues.length} user stories sem sprint`)
      .setDescription(txt.substring(0, 3900))
      .setTimestamp(),
    ]});
  }

  else if (commandName === 'issues-sem-responsavel') {
    if (!await defer()) return;
    const res    = await jiraSearch(`project=${JIRA_PROJECT} AND sprint=${JIRA_SPRINT_ID} AND assignee is EMPTY ORDER BY created ASC`, '', 50);
    const issues = res.issues || [];
    if (!issues.length) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2E7D32).setTitle('✅ Todas as issues têm responsável').setTimestamp()] });
      return;
    }
    const txt = issues.map(i => `${statusEmoji(i.fields.status.name)} [${i.key}](${jiraUrl(i.key)}) ${i.fields.summary.substring(0, 60)}\n  ↳ ${i.fields.status.name}`).join('\n');
    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(0xE65100)
      .setTitle(`⚠️ Issues sem responsável — ${issues.length} encontradas`)
      .setDescription(txt.substring(0, 3900))
      .setFooter({ text: `Sprint: ${JIRA_SPRINT_NAME}` })
      .setTimestamp(),
    ]});
  }

  else if (commandName === 'issues-devops') {
    if (!await defer()) return;
    const res    = await jiraSearch(`project=${JIRA_PROJECT} AND labels="${JIRA_DEVOPS_LABEL}" ORDER BY status ASC`, '', 50);
    const issues = res.issues || [];
    if (!issues.length) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle('⚙️ Nenhuma issue DevOps encontrada').setTimestamp()] });
      return;
    }
    const concluidas = issues.filter(i => i.fields.status.name.toLowerCase().includes('conclu') || i.fields.status.name.toLowerCase().includes('done'));
    const txt = issues.map(i => `${statusEmoji(i.fields.status.name)} [${i.key}](${jiraUrl(i.key)}) **${i.fields.summary.substring(0, 55)}**\n  ↳ ${i.fields.assignee?.displayName || 'Sem responsável'} · Atualizado: ${fmtDate(i.fields.updated)}`).join('\n');
    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(concluidas.length === issues.length ? 0x2E7D32 : 0x2E5FAC)
      .setTitle(`⚙️ Issues DevOps — ${issues.length} total · ${concluidas.length} concluídas`)
      .setDescription(txt.substring(0, 3900))
      .setTimestamp(),
    ]});
  }

  else if (commandName === 'issues-paradas') {
    if (!await defer()) return;
    const lim    = new Date(Date.now() - JIRA_DIAS_PARADA * 86400000).toISOString().split('T')[0];
    const res    = await jiraSearch(`project=${JIRA_PROJECT} AND sprint=${JIRA_SPRINT_ID} AND status="Em Andamento" AND updated<="${lim}" ORDER BY updated ASC`, '', 50);
    const issues = res.issues || [];
    if (!issues.length) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x2E7D32).setTitle('✅ Nenhuma issue parada').setDescription(`Todas as issues Em Andamento foram atualizadas nos últimos ${JIRA_DIAS_PARADA} dias.`).setTimestamp()] });
      return;
    }
    const txt = issues.map(i => `🚨 [${i.key}](${jiraUrl(i.key)}) **${i.fields.summary.substring(0, 55)}**\n  ↳ ${i.fields.assignee?.displayName || 'Sem responsável'} · Parada há **${diasDesde(i.fields.updated)} dias**`).join('\n');
    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(0xB71C1C)
      .setTitle(`🚨 Issues paradas — ${issues.length} sem atualização há +${JIRA_DIAS_PARADA} dias`)
      .setDescription(txt.substring(0, 3900))
      .setTimestamp(),
    ]});
  }

  else if (commandName === 'changelog-issue') {
    if (!await defer()) return;
    let key = interaction.options.getString('issue').trim().toUpperCase();
    if (/^\d+$/.test(key)) key = `${JIRA_PROJECT}-${key}`;
    const [issueData, changelogData] = await Promise.all([
      jiraGet(`https://${JIRA_DOMAIN}/rest/api/3/issue/${key}?fields=summary,status,assignee`),
      jiraGet(`https://${JIRA_DOMAIN}/rest/api/3/issue/${key}/changelog`),
    ]);
    if (issueData.__error || !issueData.fields) {
      await interaction.editReply({ content: `❌ Issue \`${key}\` não encontrada.` });
      return;
    }
    const camposRelevantes = ['status', 'assignee', 'priority', 'summary', 'Sprint'];
    let hist = '';
    for (const entry of (changelogData.values || []).slice(-15)) {
      for (const item of (entry.items || [])) {
        if (!camposRelevantes.includes(item.field)) continue;
        hist += `• **${fmtDate(entry.created)}** [${entry.author?.displayName || '—'}] ${item.field}: \`${item.fromString || '—'}\` → \`${item.toString || '—'}\`\n`;
      }
    }
    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(0x2E5FAC)
      .setTitle(`📜 Changelog — ${key}`)
      .setDescription(`[🔗 Abrir no Jira](${jiraUrl(key)})\n**${issueData.fields.summary}**\n${statusEmoji(issueData.fields.status.name)} **${issueData.fields.status.name}** · ${issueData.fields.assignee?.displayName || 'Sem responsável'}`)
      .addFields({ name: '📋 Histórico (últimas 15 alterações)', value: hist.substring(0, 1020) || 'Nenhuma mudança registrada.' })
      .setTimestamp(),
    ]});
  }

  else if (commandName === 'resumo-jira') {
    if (!await defer()) return;
    const res    = await jiraSearch(`project=${JIRA_PROJECT} AND sprint=${JIRA_SPRINT_ID} ORDER BY status ASC`, '', 100);
    const issues = res.issues || [];
    if (!issues.length) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle('Sprint vazia').setTimestamp()] });
      return;
    }

    const porStatus = {}, porResponsavel = {};
    const devops = [], limiteParada = new Date(Date.now() - JIRA_DIAS_PARADA * 86400000);
    let paradas = 0;

    for (const i of issues) {
      const status = i.fields.status.name;
      const resp   = i.fields.assignee?.displayName || 'Sem responsável';
      porStatus[status]       = (porStatus[status] || 0) + 1;
      porResponsavel[resp]    = (porResponsavel[resp] || 0) + 1;
      if ((i.fields.labels || []).includes(JIRA_DEVOPS_LABEL)) devops.push(i.key);
      if (status.includes('Andamento') && new Date(i.fields.updated) < limiteParada) paradas++;
    }

    const concluidas = porStatus['Concluído'] || porStatus['Done'] || 0;
    const pct        = Math.round(concluidas / issues.length * 100);
    const barra      = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));

    const stxt = Object.entries(porStatus).map(([s, n]) => `${statusEmoji(s)} **${s}:** ${n}`).join('\n');
    const mtxt = Object.entries(porResponsavel).sort((a, b) => b[1] - a[1]).map(([m, n]) => `**${m}:** ${n} issue${n > 1 ? 's' : ''}`).join('\n');

    // Quebra lista de issues em chunks de 1020 chars para o Discord
    const chunks = [];
    let chunk = '';
    for (const i of issues) {
      const linha = `${statusEmoji(i.fields.status.name)} [${i.key}](${jiraUrl(i.key)}) ${i.fields.summary.substring(0, 45)} · *${i.fields.assignee?.displayName || '—'}*\n`;
      if (chunk.length + linha.length > 1020) { chunks.push(chunk); chunk = ''; }
      chunk += linha;
    }
    if (chunk) chunks.push(chunk);

    const fields = [
      { name: '📊 Por status',       value: stxt.substring(0, 1020) || '—', inline: true },
      { name: '👤 Por responsável',  value: mtxt.substring(0, 1020) || '—', inline: true },
      { name: '⚙️ DevOps',           value: devops.length ? devops.map(k => `[${k}](${jiraUrl(k)})`).join(', ') : '✅ Nenhuma ou todas concluídas', inline: false },
    ];
    chunks.slice(0, 3).forEach((c, i) => fields.push({ name: i === 0 ? `📋 Todas as issues (${issues.length})` : '↳ continuação', value: c, inline: false }));
    if (paradas > 0) fields.push({ name: '🚨 Issues paradas', value: `**${paradas}** Em Andamento sem atualização há >${JIRA_DIAS_PARADA} dias`, inline: false });

    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(pct >= 80 ? 0x2E7D32 : pct >= 50 ? 0xF57F17 : 0xB71C1C)
      .setTitle(`📌 Resumo Completo — ${JIRA_SPRINT_NAME}`)
      .setDescription(`**${issues.length} issues** na sprint · **${concluidas} concluídas** · ${barra} **${pct}%**`)
      .addFields(fields)
      .addFields({ name: '🔗 Board', value: `[Ver quadro da sprint](${JIRA_BOARD_URL})`, inline: false })
      .setFooter({ text: `Jira · ${JIRA_PROJECT} · ${new Date().toLocaleString('pt-BR')}` })
      .setTimestamp(),
    ]});
  }

  else if (commandName === 'issue-responsavel') {
    if (!await defer()) return;
    const accountId  = interaction.options.getString('membro');
    const nomeMembro = JIRA_MEMBROS.find(m => m.accountId === accountId)?.nome || 'Membro';
    const res        = await getSprintIssues(null);
    const issues     = (res.issues || []).filter(i => i.fields.assignee?.accountId === accountId);

    if (!issues.length) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle(`📋 ${nomeMembro} — Sprint atual`).setDescription('Nenhuma issue atribuída nesta sprint.').setTimestamp()] });
      return;
    }

    const concluidas = issues.filter(i => i.fields.status.name.toLowerCase().includes('conclu') || i.fields.status.name.toLowerCase().includes('done')).length;
    const txt = issues.map(i => `${statusEmoji(i.fields.status.name)} [${i.key}](${jiraUrl(i.key)}) **${i.fields.summary.substring(0, 60)}**${(i.fields.labels || []).includes(JIRA_DEVOPS_LABEL) ? ' ⚙️' : ''}\n  ↳ ${i.fields.status.name} · Atualizado: ${fmtDate(i.fields.updated)}`).join('\n');

    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(0x2E5FAC)
      .setTitle(`👤 ${nomeMembro} — ${JIRA_SPRINT_NAME}`)
      .setDescription(`**${issues.length} issues** atribuídas · **${concluidas} concluídas**\n\n${txt.substring(0, 3800)}`)
      .setTimestamp(),
    ]});
  }

  // ── Confluence ───────────────────────────────────────────────────────────
  else if (commandName === 'confluence') {
    if (!await defer()) return;
    const pagina = interaction.options.getString('pagina');

    if (pagina === 'confluence-list') {
      const res   = await jiraProxy('confluence-list');
      const pages = res.pages || [];
      if (!pages.length) { await interaction.editReply({ content: 'Nenhuma página encontrada.' }); return; }
      const txt = pages.map(p => `• [${p.title}](${p.url})`).join('\n');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x0052CC).setTitle('📂 Confluence — The Devs').setDescription(txt.substring(0, 3900)).setTimestamp()] });
      return;
    }

    const titulos = {
      'confluence-userstories': '📖 User Stories',
      'confluence-requisitos':  '📋 Requisitos do Projeto',
      'confluence-regras':      '⚖️ Regras de Negócio',
      'confluence-backlog':     '📦 Backlog do Produto',
      'confluence-sprint1':     '📑 Backlog Sprint 1',
      'confluence-sprint2':     '📑 Backlog Sprint 2',
      'confluence-sprint3':     '📑 Backlog Sprint 3',
    };
    const res = await jiraProxy(pagina);
    if (res.__error) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xB71C1C).setTitle('❌ Página não encontrada').setDescription(`\`${res.__error}\``).setTimestamp()] });
      return;
    }
    const md   = res.markdown || 'Conteúdo não disponível.';
    const file = new AttachmentBuilder(Buffer.from(md, 'utf8'), { name: pagina.replace('confluence-', '') + '.md' });
    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(0x0052CC)
      .setTitle(`${titulos[pagina] || '📄 Página'} (v${res.version || '?'})`)
      .setDescription(`Documento completo em anexo (.md)\n\n${res.url ? `[🔗 Ver no Confluence](${res.url})` : ''}`)
      .setTimestamp()],
      files: [file],
    });
  }

  else if (['user-stories', 'requisitos', 'regras-de-negocio', 'backlog-produto'].includes(commandName)) {
    if (!await defer()) return;
    const tipoMap = {
      'user-stories':      'confluence-userstories',
      'requisitos':        'confluence-requisitos',
      'regras-de-negocio': 'confluence-regras',
      'backlog-produto':   'confluence-backlog',
    };
    const tituloMap = {
      'user-stories':      '📖 User Stories',
      'requisitos':        '📋 Requisitos do Projeto',
      'regras-de-negocio': '⚖️ Regras de Negócio',
      'backlog-produto':   '📦 Backlog do Produto',
    };
    const res = await jiraProxy(tipoMap[commandName]);
    if (res.__error) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xB71C1C).setTitle('❌ Página não encontrada').setDescription(`\`${res.__error}\``).setTimestamp()] });
      return;
    }
    const md   = res.markdown || 'Conteúdo não disponível.';
    const file = new AttachmentBuilder(Buffer.from(md, 'utf8'), { name: commandName + '.md' });
    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(0x0052CC)
      .setTitle(`${tituloMap[commandName]}${res.version ? ` (v${res.version})` : ''}`)
      .setDescription(`Documento completo em anexo (.md)\n\n${res.url ? `[🔗 Ver no Confluence](${res.url})` : ''}`)
      .setTimestamp()],
      files: [file],
    });
  }

  // ── /backup-dados ────────────────────────────────────────────────────────
  else if (commandName === 'backup-dados') {
    const d       = loadData();
    const chaves  = Object.keys(d).length;
    const semanas = Object.keys(d).filter(k => k.startsWith('semana-')).length;
    const sprints = Object.keys(d).filter(k => k.startsWith('sprint-')).length;
    const totalDailys = Object.values(d).reduce((acc, v) => acc + (v._dailys?.length || 0), 0);
    const file = new AttachmentBuilder(Buffer.from(JSON.stringify(d, null, 2), 'utf8'), { name: `backup-${new Date().toISOString().split('T')[0]}.json` });

    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(0x2E5FAC)
      .setTitle('💾 Backup dos Dados do Bot')
      .addFields(
        { name: '📦 Chaves no JSON',              value: `${chaves} total (${semanas} semanas · ${sprints} sprints)`, inline: false },
        { name: '📡 Total de dailys registradas', value: String(totalDailys),                                         inline: true  },
        { name: '💡 Como restaurar',              value: 'Edite o Gist com o conteúdo do arquivo e use `/restaurar-dados`.', inline: false },
      )
      .setFooter({ text: `QA DevOps Bot · ${new Date().toLocaleString('pt-BR')}` })
      .setTimestamp()],
      files: [file],
    });
  }

  // ── /restaurar-dados ─────────────────────────────────────────────────────
  else if (commandName === 'restaurar-dados') {
    await interaction.deferReply();
    console.log('[RESTAURAR] Chamado por', user.username);

    const gistData = await gistRead();
    if (!gistData) {
      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setColor(0xB71C1C)
        .setTitle('❌ Falha ao restaurar')
        .setDescription('Não foi possível ler o Gist. Verifique `GITHUB_TOKEN` e `GIST_ID` nas variáveis de ambiente.')
        .setTimestamp(),
      ]});
      return;
    }

    saveDataLocal(gistData);
    const chaves      = Object.keys(gistData).length;
    const totalDailys = Object.values(gistData).reduce((acc, v) => acc + (v._dailys?.length || 0), 0);
    console.log('[RESTAURAR] ✅', chaves, 'chaves restauradas');

    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(0x2E7D32)
      .setTitle('✅ Dados Restaurados do Gist')
      .addFields(
        { name: '📦 Chaves restauradas',          value: String(chaves),      inline: true },
        { name: '📡 Dailys restauradas',           value: String(totalDailys), inline: true },
        { name: '💡 Resultado', value: 'Os dados do bot foram substituídos pelo conteúdo atual do Gist.', inline: false },
      )
      .setTimestamp(),
    ]});
  }

  // ── /historico-dailys ───────────────────────────────────────────────────
  else if (commandName === 'historico-dailys') {
    const todasChaves = Object.keys(data)
      .filter(k => k.startsWith('semana-'))
      .sort()
      .reverse(); // mais recente primeiro

    if (!todasChaves.length) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle('📡 Nenhuma daily registrada ainda.').setTimestamp()] });
      return;
    }

    const fields = [];
    let totalGeral = 0;

    for (const chave of todasChaves) {
      const dailys = data[chave]?._dailys || [];
      if (!dailys.length) continue;
      totalGeral += dailys.length;

      const semanaNum = chave.replace('semana-', '');
      let txt = '';
      for (const d of dailys) {
        const ausStr = d.ausentes.length ? ' · ❌ ' + d.ausentes.map(a => a.nome).join(', ') : ' · ✅ todos presentes';
        txt += `**${d.diaSemana}** ${formatDate(d.data)} — ${d.presentes.length}/${d.totalMembros} · ${d.duracaoMin}min${ausStr}
`;
      }

      // Divide se passar de 1020 chars
      if (txt.length > 1020) txt = txt.substring(0, 1017) + '…';
      fields.push({ name: `📅 Semana ${semanaNum} — ${dailys.length} daily(s)`, value: txt, inline: false });
    }

    if (!fields.length) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x888888).setTitle('📡 Nenhuma daily registrada ainda.').setTimestamp()] });
      return;
    }

    // Discord limita a 25 fields por embed — se tiver mais, trunca
    const embed = new EmbedBuilder()
      .setColor(0x2E5FAC)
      .setTitle(`📡 Histórico de Dailys — ${totalGeral} total`)
      .setDescription(`Todas as dailys registradas pelo bot, da mais recente para a mais antiga.`)
      .addFields(fields.slice(0, 25))
      .setTimestamp();

    if (fields.length > 25) embed.setFooter({ text: `Mostrando 25 de ${fields.length} semanas` });
    await interaction.reply({ embeds: [embed] });
  }

  // ── /historico-impedimentos ──────────────────────────────────────────────
  else if (commandName === 'historico-impedimentos') {
    const todasChaves = Object.keys(data)
      .filter(k => k.startsWith('semana-'))
      .sort()
      .reverse();

    // Conta total real de impedimentos em todas as semanas
    let totalGeral = 0;
    const fields = [];

    for (const chave of todasChaves) {
      const semana = data[chave] || {};
      const uids = Object.keys(semana).filter(k => !k.startsWith('_'));
      if (!uids.length) continue;

      const semanaNum = chave.replace('semana-', '');
      let txt = '';
      let temAlgo = false;

      for (const uid of uids) {
        const dev = semana[uid];
        const lista = dev.impedimentos || [];
        if (!lista.length) continue;
        temAlgo = true;
        totalGeral += lista.length;

        txt += `**${dev.nome}**
`;
        for (const i of lista) {
          const status = i.resolvido ? `✅ resolvido em ${formatDate(i.dataResolucao)}` : '🔴 aberto';
          const arrastado = i.arrastado ? ' *(arrastado)*' : '';
          txt += `  • \`${i.id}\` ${i.descricao}${i.tarefa ? ` *(${i.tarefa})*` : ''} — ${status}${arrastado}
`;
        }
      }

      if (!temAlgo) continue;
      if (txt.length > 1020) txt = txt.substring(0, 1017) + '…';
      fields.push({ name: `📅 Semana ${semanaNum}`, value: txt, inline: false });
    }

    if (!fields.length) {
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2E7D32).setTitle('✅ Nenhum impedimento registrado ainda.').setTimestamp()] });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(totalGeral > 0 ? 0x2E5FAC : 0x2E7D32)
      .setTitle(`📋 Histórico de Impedimentos — ${totalGeral} total`)
      .setDescription('Todos os impedimentos registrados, da semana mais recente para a mais antiga.')
      .addFields(fields.slice(0, 25))
      .setTimestamp();

    if (fields.length > 25) embed.setFooter({ text: `Mostrando 25 de ${fields.length} semanas` });
    await interaction.reply({ embeds: [embed] });
  }

  // ── /ultimo-deploy ──────────────────────────────────────────────────────
  else if (commandName === 'ultimo-deploy') {
    if (!await defer()) return;
    const releases = await gitlabGetReleases();
    if (!releases.length) {
      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setColor(0x888888)
        .setTitle('🚀 Nenhum deploy registrado')
        .setDescription('Nenhuma release formal foi encontrada nos repositórios.\n\nPara registrar um deploy, o responsável de deploy deve criar uma **Release** no GitLab com uma tag de versão (ex: `v1.0.0`).')
        .setTimestamp(),
      ]});
      return;
    }
    const rel = releases[0];
    const data = new Date(rel.createdAt).toLocaleString('pt-BR');
    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(0x2E7D32)
      .setTitle(`🚀 Último Deploy — ${rel.tag}`)
      .setDescription(`**${rel.name}**`)
      .addFields(
        { name: '📦 Repositório', value: rel.repo,   inline: true },
        { name: '📅 Data',        value: data,        inline: true },
        { name: '👤 Autor',       value: rel.author,  inline: true },
        { name: '🔗 Link',        value: `[Ver release no GitLab](${rel.url})`, inline: false },
        ...(rel.description ? [{ name: '📝 Notas', value: rel.description.substring(0, 1020), inline: false }] : []),
      )
      .setFooter({ text: `${releases.length} release(s) encontrada(s) no total` })
      .setTimestamp(),
    ]});
  }

  // ── /historico-deploy ────────────────────────────────────────────────────
  else if (commandName === 'historico-deploy') {
    if (!await defer()) return;
    const releases = await gitlabGetReleases();
    if (!releases.length) {
      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setColor(0x888888)
        .setTitle('🚀 Nenhum deploy registrado')
        .setDescription('Nenhuma release formal foi encontrada nos repositórios.\n\nPara registrar um deploy, crie uma **Release** no GitLab com uma tag de versão (ex: `v1.0.0`).')
        .setTimestamp(),
      ]});
      return;
    }
    const lista = releases.slice(0, 15).map((rel, i) => {
      const data = new Date(rel.createdAt).toLocaleDateString('pt-BR');
      return `${i === 0 ? '🟢' : '⚪'} **${rel.tag}** — ${rel.repo} · ${data} · ${rel.author}\n  ↳ [Ver release](${rel.url})`;
    }).join('\n');
    await interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor(0x2E5FAC)
      .setTitle(`🚀 Histórico de Deploys — ${releases.length} release(s)`)
      .setDescription(lista.substring(0, 3900))
      .setFooter({ text: 'GitLab Releases · Mais recente no topo' })
      .setTimestamp(),
    ]});
  }

  // ── /ajuda ───────────────────────────────────────────────────────────────
  else if (commandName === 'ajuda') {
    await interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(0x2E5FAC)
      .setTitle('🤖 TheDevs QA Bot — Guia de Comandos')
      .setDescription('Bot de auditoria QA DevOps para o time The-Devs · Tecsus · Fatec 4º Sem')
      .addFields(
        { name: '📋 Impedimentos',   value: '`/impedimento` · `/impedimento-resolvido` · `/meus-impedimentos` · `/impedimentos-time` · `/historico-impedimentos`', inline: false },
        { name: '🧹 Limpeza',        value: '`/limpar-resolvidos-semana` · `/limpar-resolvidos-tudo`\n`/limpar-impedimentos-semana` · `/limpar-impedimentos-tudo`', inline: false },
        { name: '📡 Daily Scrum',    value: `**Automático** — ${DAILY_MIN}+ membros no canal de voz **Daily** inicia o registro\n\`/daily-status\` — Status da semana atual · \`/historico-dailys\` — Todas as semanas\nLembrete às **7h** · Resumo toda **segunda**`, inline: false },
        { name: '📊 Jira — Sprint',  value: '`/resumo-jira` · `/issue-responsavel` · `/backlog`', inline: false },
        { name: '⚠️ Jira — Alertas', value: '`/issues-sem-responsavel` · `/issues-devops` · `/issues-paradas`', inline: false },
        { name: '🔍 Jira — Detalhes', value: '`/changelog-issue` — Aceita `SCRUM-85` ou apenas `85`', inline: false },
        { name: '📚 Confluence',     value: '`/confluence` — Dropdown com todas as páginas\n`/user-stories` · `/requisitos` · `/regras-de-negocio` · `/backlog-produto`', inline: false },
        { name: '🔧 Manutenção',     value: '`/backup-dados` — Exporta JSON como arquivo\n`/restaurar-dados` — Puxa dados do Gist sem redeploy', inline: false },
        { name: '🚀 Deploy',          value: '`/ultimo-deploy` — Último release/deploy registrado no GitLab\n`/historico-deploy` — Lista todos os releases do projeto', inline: false },
        { name: '💡 Dicas',          value: `• Issues DevOps precisam ter label \`${JIRA_DEVOPS_LABEL}\` no Jira\n• Mínimo de **${DAILY_MIN} dailys/semana** para considerar conforme`, inline: false },
      )
      .setFooter({ text: 'QA DevOps Bot · The-Devs · Tecsus · Fatec 4º Sem' })
      .setTimestamp(),
    ]});
  }
});

// ─── SERVIDOR HTTP ───────────────────────────────────────────────────────────
// Expõe endpoints consumidos pelo n8n (auditoria semanal) e para manutenção manual.

http.createServer(async (req, res) => {
  const url = req.url || '/';

  if (url === '/' || url === '/health') {
    res.writeHead(200); res.end('OK');
    return;
  }

  if (url.startsWith('/impedimentos')) {
    const params = new URLSearchParams(url.split('?')[1] || '');
    const data   = loadData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data[params.get('sprint') || getSprintKey()] || {}));
    return;
  }

  if (url.startsWith('/dailys')) {
    const params  = new URLSearchParams(url.split('?')[1] || '');
    const data    = loadData();
    const chave   = params.get('semana') || getWeekKey();
    const dailys  = data[chave]?._dailys || [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ semana: chave, dailys, total: dailys.length }));
    return;
  }

  if (url === '/backup-dados') {
    const data = loadData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
    return;
  }

  if (url === '/restaurar-dados' && req.method === 'POST') {
    const gistData = await gistRead();
    if (!gistData) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, erro: 'Não foi possível ler o Gist' }));
      return;
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(gistData, null, 2));
    console.log('[RESTAURAR HTTP] ✅', Object.keys(gistData).length, 'chaves');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, chaves: Object.keys(gistData).length }));
    return;
  }

  res.writeHead(404); res.end('Not found');

}).listen(process.env.PORT || 3000, () => console.log('🌐 HTTP server na porta', process.env.PORT || 3000));

client.login(BOT_TOKEN);