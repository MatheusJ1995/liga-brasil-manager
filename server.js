'use strict';
// ============================================================================
//  server.js  -  servidor web + API + agendador de rodadas
//  Sem dependências externas: basta ter Node.js 18+ instalado.
// ============================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const G = require('./game');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const STATE_KEY = process.env.STATE_KEY || 'main';
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOGOS_DIR = path.join(PUBLIC_DIR, 'logos');
const LOGOS = new Set(
  fs.existsSync(LOGOS_DIR)
    ? fs.readdirSync(LOGOS_DIR).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4))
    : []
);

// ------------------------------------------------------------- PERSISTÊNCIA -
let world;
function migrateWorld() {
  G.ensureFinance(world);
  G.ensureMarket(world);
  G.ensurePlayers(world);
}

async function loadRemote() {
  if (SUPABASE_URL && SUPABASE_KEY) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/liga_state?id=eq.${encodeURIComponent(STATE_KEY)}&select=data`, {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
    });
    if (!res.ok) throw new Error(`Supabase GET ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    return rows.length ? rows[0].data : null;
  }
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const res = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + UPSTASH_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', 'liga:' + STATE_KEY]),
    });
    if (!res.ok) throw new Error(`Upstash GET ${res.status}: ${await res.text()}`);
    const j = await res.json();
    return j.result ? JSON.parse(j.result) : null;
  }
  return null;
}

async function saveRemote(json) {
  if (SUPABASE_URL && SUPABASE_KEY) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/liga_state`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ id: STATE_KEY, data: JSON.parse(json), updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(`Supabase POST ${res.status}: ${await res.text()}`);
  } else if (UPSTASH_URL && UPSTASH_TOKEN) {
    const res = await fetch(UPSTASH_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + UPSTASH_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', 'liga:' + STATE_KEY, json]),
    });
    if (!res.ok) throw new Error(`Upstash SET ${res.status}: ${await res.text()}`);
  }
}

async function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const hasRemote = (SUPABASE_URL && SUPABASE_KEY) || (UPSTASH_URL && UPSTASH_TOKEN);
  if (hasRemote) {
    const remote = await loadRemote();
    if (remote) {
      world = remote;
      migrateWorld();
      console.log(`[liga] estado carregado da nuvem (temporada ${world.season})`);
      return;
    }
    if (fs.existsSync(STATE_FILE)) {
      world = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      migrateWorld();
      await saveNow();
      console.log(`[liga] estado local migrado para a nuvem (temporada ${world.season})`);
      return;
    }
    world = G.createWorld();
    await saveNow();
    console.log('[liga] nova liga criada na nuvem');
    return;
  }
  if (fs.existsSync(STATE_FILE)) {
    world = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    migrateWorld();
    console.log(`[liga] estado carregado (temporada ${world.season})`);
  } else {
    world = G.createWorld();
    await saveNow();
    console.log('[liga] nova liga criada');
  }
}
let saveTimer = null, saving = false, saveQueued = false;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 500);
}
async function saveNow() {
  if (saving) { saveQueued = true; return; }
  saving = true;
  try {
    do {
      saveQueued = false;
      const json = JSON.stringify(world);
      // Nunca derruba o servidor por falha de disco: recria a pasta se alguém apagou e tenta de novo no próximo ciclo.
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = STATE_FILE + '.tmp';
        fs.writeFileSync(tmp, json);
        fs.renameSync(tmp, STATE_FILE);
      } catch (e) {
        console.error('[liga] ERRO ao salvar local:', e.message);
      }
      try {
        await saveRemote(json);
      } catch (e) {
        console.error('[liga] ERRO ao salvar na nuvem:', e.message);
      }
    } while (saveQueued);
  } finally {
    saving = false;
  }
}

// -------------------------------------------------------------- AGENDADOR ---
// A cada 15s verifica se existe rodada cujo horário já passou e simula.
// Se o servidor ficou fora do ar, as rodadas atrasadas são jogadas em ordem.
function tick() {
  let changed = false;
  for (let guard = 0; guard < 80; guard++) {
    const f = G.nextFixture(world);
    if (!f || f.kickoff > Date.now()) break;
    G.playRound(world, f);
    console.log(`[liga] rodada ${f.round} da temporada ${world.season} simulada`);
    changed = true;
  }
  if (changed) save();
}

// ----------------------------------------------------------------- HELPERS --
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (msg, code = 400) => new HttpError(code, msg);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 20000) { reject(bad('Corpo grande demais', 413)); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(bad('JSON inválido')); } });
  });
}

function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 32).toString('hex');
}
function hashCpf(digits) {
  if (!world.cpfSalt) world.cpfSalt = crypto.randomBytes(16).toString('hex');
  return crypto.createHash('sha256').update(world.cpfSalt + ':' + digits).digest('hex');
}
function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const s = world.sessions[token];
  if (!s) return null;
  return world.users[s.userId] || null;
}
function needUser(req) {
  const u = authUser(req);
  if (!u) throw bad('Faça login para continuar', 401);
  return u;
}

// limitador simples de tentativas de login/cadastro por IP
const attempts = new Map();
function rateLimit(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const arr = (attempts.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (arr.length >= 30) throw bad('Muitas tentativas. Aguarde alguns minutos.', 429);
  arr.push(now);
  attempts.set(ip, arr);
}

function newSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  world.sessions[token] = { userId, at: Date.now() };
  return token;
}

const sum = (arr, k) => arr.reduce((a, e) => a + (e[k] || 0), 0);
const ownerName = t => (t.ownerId && world.users[t.ownerId]) ? world.users[t.ownerId].name : null;
const teamBrief = t => ({
  id: t.id, name: t.name, short: t.short, c1: t.c1, c2: t.c2,
  logo: LOGOS.has(t.id) ? `logos/${t.id}.png` : null,
  owner: ownerName(t),
  strength: Math.round(G.lineupForMatch(t).strength.overall),
});
const matchOut = (m, fx) => ({
  h: m.h, a: m.a, hn: world.teams[m.h].name, an: world.teams[m.a].name,
  hs: world.teams[m.h].short, as: world.teams[m.a].short,
  done: m.done, hg: m.hg, ag: m.ag, goals: m.goals || [],
  cards: m.cards || [], injuries: m.injuries || [],
  hf: m.hf, af: m.af,
  hStr: m.hs, aStr: m.as,
});
const fixtureOut = f => ({
  round: f.round, kickoff: f.kickoff, done: f.done,
  matches: f.matches.map(m => matchOut(m, f)),
});
function lockInfo() {
  const f = G.nextFixture(world);
  if (!f) return { round: null };
  const lockAt = f.kickoff - G.LOCK_MS;
  return { round: f.round, kickoff: f.kickoff, lockAt, locked: Date.now() >= lockAt };
}
function playerOut(p) {
  return {
    id: p.id, name: p.name, pos: p.pos, ovr: p.ovr, age: p.age, goals: p.goals, wage: G.wageOf(p.ovr),
    yellows: p.yellows || 0, totalYellows: p.totalYellows || 0, totalReds: p.totalReds || 0,
    suspended: p.suspended || 0, injured: p.injured || 0, injuryName: p.injuryName || null,
  };
}
const posOrder = { GK: 0, DEF: 1, MID: 2, ATT: 3 };
const sortPlayers = a => a.slice().sort((x, y) => posOrder[x.pos] - posOrder[y.pos] || y.ovr - x.ovr);

function teamResults(teamId) {
  const out = [];
  for (const f of world.fixtures) for (const m of f.matches)
    if (m.done && (m.h === teamId || m.a === teamId)) out.push({ round: f.round, kickoff: f.kickoff, ...matchOut(m, f) });
  return out;
}

// ---------------------------------------------------------------------- API -
async function api(req, res, url) {
  const route = req.method + ' ' + url.pathname;

  if (route === 'POST /api/register' || route === 'POST /api/login') {
    rateLimit(req);
    const b = await readBody(req);
    const name = String(b.name || '').trim();
    const pw = String(b.password || '');
    if (!/^[\p{L}\p{N} _.-]{3,20}$/u.test(name)) throw bad('Nome: 3 a 20 caracteres (letras, números, espaço, _ . -)');
    if (pw.length < 6 || pw.length > 100) throw bad('Senha: mínimo 6 caracteres');
    const key = name.toLowerCase();
    let user = Object.values(world.users).find(u => u.name.toLowerCase() === key);
    if (url.pathname === '/api/register') {
      if (user) throw bad('Esse nome já está em uso');
      const cpf = G.cleanCpf(b.cpf);
      if (!G.isValidCpf(cpf)) throw bad('CPF inválido');
      const cpfHash = hashCpf(cpf);
      if (Object.values(world.users).some(u => u.cpfHash === cpfHash)) {
        throw bad('Já existe uma conta cadastrada com este CPF');
      }
      const id = crypto.randomBytes(6).toString('hex');
      const salt = crypto.randomBytes(16).toString('hex');
      user = { id, name, cpfHash, salt, hash: hashPassword(pw, salt), teamId: null, createdAt: Date.now() };
      world.users[id] = user;
    } else {
      if (!user) throw bad('Usuário ou senha incorretos', 401);
      const a = Buffer.from(hashPassword(pw, user.salt), 'hex'), c = Buffer.from(user.hash, 'hex');
      if (!crypto.timingSafeEqual(a, c)) throw bad('Usuário ou senha incorretos', 401);
    }
    const token = newSession(user.id);
    save();
    return send(res, 200, { token, name: user.name });
  }

  if (route === 'GET /api/health') {
    return send(res, 200, { ok: true, season: world.season });
  }

  if (route === 'GET /api/teams') {
    return send(res, 200, { teams: Object.values(world.teams).map(teamBrief) });
  }

  if (route === 'GET /api/state') {
    const lock = lockInfo();
    const table = G.computeTable(world).map((r, i) => ({
      pos: i + 1, ...r, name: world.teams[r.id].name, short: world.teams[r.id].short,
      c1: world.teams[r.id].c1, owner: ownerName(world.teams[r.id]),
    }));
    const played = world.fixtures.filter(f => f.done);
    const last = played.length ? fixtureOut(played[played.length - 1]) : null;
    const next = G.nextFixture(world);
    return send(res, 200, {
      serverNow: Date.now(), season: world.season, totalRounds: world.fixtures.length,
      lock, table, lastRound: last, nextRound: next ? fixtureOut(next) : null,
      history: world.history.map(h => ({ ...h, championName: world.teams[h.champion].name })),
    });
  }

  if (route === 'GET /api/rounds') {
    return send(res, 200, { rounds: world.fixtures.map(f => ({ round: f.round, kickoff: f.kickoff, done: f.done })) });
  }
  let m;
  if ((m = url.pathname.match(/^\/api\/round\/(\d+)$/)) && req.method === 'GET') {
    const f = world.fixtures.find(x => x.round === +m[1]);
    if (!f) throw bad('Rodada não encontrada', 404);
    return send(res, 200, fixtureOut(f));
  }
  if ((m = url.pathname.match(/^\/api\/team\/([a-z]+)$/)) && req.method === 'GET') {
    const t = world.teams[m[1]];
    if (!t) throw bad('Time não encontrado', 404);
    const lu = G.lineupForMatch(t);
    return send(res, 200, {
      team: teamBrief(t), formation: lu.formation, lineup: lu.lineup, strength: lu.strength,
      players: sortPlayers(t.players).map(playerOut), results: teamResults(t.id),
    });
  }
  if (route === 'GET /api/scorers') {
    return send(res, 200, { scorers: G.topScorers(world, 20) });
  }

  // ---- a partir daqui precisa estar logado
  if (route === 'GET /api/me') {
    const u = needUser(req);
    const t = u.teamId ? world.teams[u.teamId] : null;
    return send(res, 200, { name: u.name, teamId: u.teamId, team: t ? teamBrief(t) : null, serverNow: Date.now() });
  }

  if (route === 'POST /api/claim') {
    const u = needUser(req);
    if (u.teamId) throw bad('Você já escolheu um time');
    const b = await readBody(req);
    const t = world.teams[b.teamId];
    if (!t) throw bad('Time não encontrado', 404);
    if (t.ownerId) throw bad('Esse time já tem treinador');
    t.ownerId = u.id; u.teamId = t.id;
    t.formation = '4-4-2';
    t.lineup = G.bestLineup(t, t.formation);
    save();
    return send(res, 200, { ok: true, teamId: t.id });
  }

  if (route === 'GET /api/myteam') {
    const u = needUser(req);
    if (!u.teamId) throw bad('Escolha um time primeiro');
    const t = world.teams[u.teamId];
    const lu = (t.ownerId && t.lineup)
      ? { formation: t.formation, lineup: t.lineup, strength: G.lineupStrength(t, t.lineup, t.formation) }
      : G.lineupForMatch(t);
    return send(res, 200, {
      team: teamBrief(t), formation: lu.formation, lineup: lu.lineup,
      strength: lu.strength, players: sortPlayers(t.players).map(playerOut),
      formations: Object.keys(G.FORMATIONS), lock: lockInfo(), serverNow: Date.now(),
    });
  }

  if (route === 'GET /api/auto') {
    const u = needUser(req);
    if (!u.teamId) throw bad('Escolha um time primeiro');
    const f = url.searchParams.get('formation') || '4-4-2';
    if (!G.FORMATIONS[f]) throw bad('Formação inválida');
    const t = world.teams[u.teamId];
    return send(res, 200, { lineup: G.bestLineup(t, f) });
  }

  if (route === 'POST /api/preview' || route === 'POST /api/lineup') {
    const u = needUser(req);
    if (!u.teamId) throw bad('Escolha um time primeiro');
    const t = world.teams[u.teamId];
    const b = await readBody(req);
    const s = G.lineupStrength(t, b.lineup, b.formation);
    if (url.pathname === '/api/preview') return send(res, 200, s);
    if (s.error) throw bad(s.error);
    const lock = lockInfo();
    if (lock.locked) throw bad('Escalação travada: faltam menos de 1h para a partida', 403);
    t.formation = b.formation; t.lineup = b.lineup;
    save();
    return send(res, 200, { ok: true, strength: s });
  }

  // ---- finanças
  if (route === 'GET /api/finance') {
    const u = needUser(req);
    if (!u.teamId) throw bad('Escolha um time primeiro');
    const t = world.teams[u.teamId];
    const next = G.nextFixture(world);
    const nm = next && next.matches.find(x => x.h === t.id || x.a === t.id);
    const wages = G.payroll(t), sponsor = G.sponsorOf(t);
    const last = t.fin.slice(-12).reverse();
    const season = t.fin.filter(e => e.s === world.season);
    return send(res, 200, {
      cash: t.cash, ticketPrice: t.ticketPrice, capacity: G.capacityOf(t), refPrice: G.prefPrice(t),
      minPrice: G.MIN_PRICE, maxPrice: G.MAX_PRICE,
      wages, sponsor, nextHome: !!(nm && nm.h === t.id),
      nextOpponent: nm ? world.teams[nm.h === t.id ? nm.a : nm.h].name : null,
      form: t.form || [], lock: lockInfo(), serverNow: Date.now(),
      season: { gate: sum(season, 'gate'), sponsor: sum(season, 'sponsor'), wages: sum(season, 'wages'), net: sum(season, 'net'), games: season.length },
      log: last,
    });
  }
  if (route === 'GET /api/finance/preview') {
    const u = needUser(req);
    if (!u.teamId) throw bad('Escolha um time primeiro');
    const t = world.teams[u.teamId];
    const price = Math.round(Number(url.searchParams.get('price')));
    if (!Number.isFinite(price) || price < G.MIN_PRICE || price > G.MAX_PRICE) throw bad(`Preço entre R$ ${G.MIN_PRICE} e R$ ${G.MAX_PRICE}`);
    const att = G.estimateAttendance(t, price);
    return send(res, 200, { price, attendance: att, capacity: G.capacityOf(t), gate: att * price });
  }
  if (route === 'POST /api/ticket') {
    const u = needUser(req);
    if (!u.teamId) throw bad('Escolha um time primeiro');
    const t = world.teams[u.teamId];
    const b = await readBody(req);
    const price = Math.round(Number(b.price));
    if (!Number.isFinite(price) || price < G.MIN_PRICE || price > G.MAX_PRICE) throw bad(`Preço entre R$ ${G.MIN_PRICE} e R$ ${G.MAX_PRICE}`);
    if (lockInfo().locked) throw bad('Travado: faltam menos de 1h para a partida', 403);
    t.ticketPrice = price;
    save();
    return send(res, 200, { ok: true, ticketPrice: price });
  }
  if (route === 'GET /api/finance/league') {
    const rows = Object.values(world.teams).map(t => ({
      id: t.id, name: t.name, short: t.short, c1: t.c1, owner: ownerName(t), cash: t.cash,
    })).sort((a, b) => b.cash - a.cash);
    return send(res, 200, { rows });
  }

  // ---- mercado (troca entre treinadores)
  if (route === 'GET /api/market') {
    const u = needUser(req);
    if (!u.teamId) throw bad('Escolha um time primeiro');
    const t = world.teams[u.teamId];
    const humans = Object.values(world.teams).filter(x => x.ownerId && x.id !== t.id)
      .map(x => ({ id: x.id, name: x.name, short: x.short, c1: x.c1, owner: ownerName(x), cash: x.cash, banned: G.isBanned(x), size: x.players.length }));
    const incoming = world.offers.filter(o => o.to === t.id && o.status === 'pending').length;
    return send(res, 200, {
      status: G.marketStatus(world), serverNow: Date.now(), cash: t.cash, banned: G.isBanned(t), squadSize: t.players.length,
      limits: { min: G.SQUAD_MIN, max: G.SQUAD_MAX, posMin: G.POS_MIN, maxPending: G.MAX_PENDING, minRatio: G.MIN_OFFER_RATIO },
      teams: humans, incoming,
      transfers: world.transfers.slice(-15).reverse().map(x => ({
        at: x.at, season: x.season, round: x.round, player: x.player, money: x.money, swap: x.swap,
        from: world.teams[x.from].name, to: world.teams[x.to].name, fromShort: world.teams[x.from].short, toShort: world.teams[x.to].short,
      })),
    });
  }
  if ((m = url.pathname.match(/^\/api\/market\/team\/([a-z]+)$/)) && req.method === 'GET') {
    const u = needUser(req);
    if (!u.teamId) throw bad('Escolha um time primeiro');
    const t = world.teams[m[1]];
    if (!t || !t.ownerId || t.id === u.teamId) throw bad('Time não disponível para negociação', 404);
    return send(res, 200, { team: teamBrief(t), cash: t.cash, banned: G.isBanned(t), players: sortPlayers(t.players).map(G.playerSnap) });
  }
  if (route === 'GET /api/market/mine') {
    const u = needUser(req);
    if (!u.teamId) throw bad('Escolha um time primeiro');
    return send(res, 200, { players: sortPlayers(world.teams[u.teamId].players).map(G.playerSnap) });
  }
  if (route === 'GET /api/market/offers') {
    const u = needUser(req);
    if (!u.teamId) throw bad('Escolha um time primeiro');
    const mine = world.offers.filter(o => o.from === u.teamId || o.to === u.teamId);
    const out = o => ({
      id: o.id, status: o.status, note: o.note || null, money: o.money, createdAt: o.createdAt, resolvedAt: o.resolvedAt || null,
      from: o.from, fromName: world.teams[o.from].name, fromOwner: ownerName(world.teams[o.from]),
      to: o.to, toName: world.teams[o.to].name, toOwner: ownerName(world.teams[o.to]),
      want: o.wantSnap, swap: o.swapSnap,
    });
    const pend = mine.filter(o => o.status === 'pending').sort((a, b) => b.createdAt - a.createdAt);
    return send(res, 200, {
      incoming: pend.filter(o => o.to === u.teamId).map(out),
      outgoing: pend.filter(o => o.from === u.teamId).map(out),
      history: mine.filter(o => o.status !== 'pending').sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0)).slice(0, 10).map(out),
    });
  }
  if (route === 'POST /api/market/offer') {
    const u = needUser(req);
    if (!u.teamId) throw bad('Escolha um time primeiro');
    const b = await readBody(req);
    const o = {
      id: crypto.randomBytes(5).toString('hex'), status: 'pending', createdAt: Date.now(),
      from: u.teamId, to: String(b.to || ''), pid: String(b.pid || ''),
      money: Number(b.money), swapPid: b.swapPid ? String(b.swapPid) : null,
    };
    const err = G.validateOffer(world, o);
    if (err) throw bad(err, 400);
    const pending = world.offers.filter(x => x.from === u.teamId && x.status === 'pending');
    if (pending.length >= G.MAX_PENDING) throw bad(`Você já tem ${G.MAX_PENDING} propostas pendentes. Cancele alguma antes.`);
    if (pending.some(x => x.pid === o.pid)) throw bad('Você já fez uma proposta por esse jogador');
    o.wantSnap = G.playerSnap(world.teams[o.to].players.find(p => p.id === o.pid));
    o.swapSnap = o.swapPid ? G.playerSnap(world.teams[o.from].players.find(p => p.id === o.swapPid)) : null;
    world.offers.push(o);
    save();
    return send(res, 200, { ok: true, id: o.id });
  }
  if (route === 'POST /api/market/respond') {
    const u = needUser(req);
    if (!u.teamId) throw bad('Escolha um time primeiro');
    const b = await readBody(req);
    const o = world.offers.find(x => x.id === b.id);
    if (!o) throw bad('Proposta não encontrada', 404);
    if (o.status !== 'pending') throw bad('Essa proposta já foi encerrada');
    const finish = (status, note) => { o.status = status; o.resolvedAt = Date.now(); if (note) o.note = note; save(); };
    if (b.action === 'cancel') {
      if (o.from !== u.teamId) throw bad('Só quem enviou pode cancelar', 403);
      finish('cancelled');
      return send(res, 200, { ok: true });
    }
    if (o.to !== u.teamId) throw bad('Só o dono do jogador pode responder', 403);
    if (b.action === 'reject') { finish('rejected'); return send(res, 200, { ok: true }); }
    if (b.action !== 'accept') throw bad('Ação inválida');
    const seller = world.teams[o.to], buyer = world.teams[o.from];
    if (!seller.players.some(p => p.id === o.pid) || (o.swapPid && !buyer.players.some(p => p.id === o.swapPid))) {
      finish('expired', 'Jogador não está mais no clube');
      throw bad('Essa proposta não vale mais: um dos jogadores já mudou de clube');
    }
    const err = G.validateOffer(world, o);
    if (err) throw bad(err);
    G.applyTransfer(world, o);
    finish('accepted');
    return send(res, 200, { ok: true });
  }

  // ---- ferramenta de teste (só funciona se ADMIN_KEY estiver definida)
  if (route === 'POST /api/admin/simulate') {
    if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) throw bad('Não autorizado', 403);
    const f = G.nextFixture(world);
    if (!f) throw bad('Sem rodada pendente');
    G.playRound(world, f);
    save();
    return send(res, 200, { ok: true, round: f.round });
  }

  throw bad('Rota não encontrada', 404);
}

// ---------------------------------------------------------------- ESTÁTICO --
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Não encontrado');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// ----------------------------------------------------------------- SERVER ---
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Erro interno' });
  }
});

load().then(() => {
  setInterval(tick, 15000);
  tick();
  server.listen(PORT, () => console.log(`[liga] rodando em http://localhost:${PORT}`));
}).catch(e => {
  console.error('[liga] ERRO ao carregar estado inicial:', e);
  process.exit(1);
});

process.on('uncaughtException', e => console.error('[liga] erro inesperado (servidor continua):', e));
process.on('unhandledRejection', e => console.error('[liga] promessa rejeitada (servidor continua):', e));

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await saveNow(); process.exit(0); });
