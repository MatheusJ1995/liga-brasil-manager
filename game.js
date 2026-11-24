'use strict';
// ============================================================================
//  game.js  -  regras do jogo: times, jogadores, calendário e simulação
//  Tudo aqui é independente do servidor web (fácil de testar e de evoluir).
// ============================================================================
const REAL_SQUADS = require('./squads');

// ---------------------------------------------------------------- CONFIG ----
// Horário de Brasília (UTC-3, sem horário de verão desde 2019)
const BRT_OFFSET = -3 * 3600 * 1000;
// Dias e horários das partidas: 0 = domingo, 3 = quarta  ->  [hora, minuto]
const KICKOFF = { 3: [21, 30], 0: [16, 0] };
// Quanto tempo antes do jogo a escalação trava
const LOCK_MS = 60 * 60 * 1000;

// Ordem das posições e formações (quantidade de jogadores por posição)
const POS = ['GK', 'DEF', 'MID', 'ATT'];
const FORMATIONS = {
  '4-4-2': { GK: 1, DEF: 4, MID: 4, ATT: 2 },
  '4-3-3': { GK: 1, DEF: 4, MID: 3, ATT: 3 },
  '4-5-1': { GK: 1, DEF: 4, MID: 5, ATT: 1 },
  '3-5-2': { GK: 1, DEF: 3, MID: 5, ATT: 2 },
  '3-4-3': { GK: 1, DEF: 3, MID: 4, ATT: 3 },
  '5-3-2': { GK: 1, DEF: 5, MID: 3, ATT: 2 },
  '5-4-1': { GK: 1, DEF: 5, MID: 4, ATT: 1 },
};

// Times (nomes de clubes são livres; os jogadores são FICTÍCIOS e gerados).
// "rating" = força média do elenco. Ajuste à vontade.
const TEAMS = [
  { id: 'fla', name: 'Flamengo',       short: 'FLA', c1: '#c8102e', c2: '#111111', rating: 82 },
  { id: 'pal', name: 'Palmeiras',      short: 'PAL', c1: '#006437', c2: '#ffffff', rating: 80 },
  { id: 'bot', name: 'Botafogo',       short: 'BOT', c1: '#111111', c2: '#ffffff', rating: 77 },
  { id: 'cam', name: 'Atlético-MG',    short: 'CAM', c1: '#111111', c2: '#ffffff', rating: 75 },
  { id: 'flu', name: 'Fluminense',     short: 'FLU', c1: '#7a0c2e', c2: '#0b6b3a', rating: 74 },
  { id: 'spf', name: 'São Paulo',      short: 'SAO', c1: '#e30613', c2: '#111111', rating: 74 },
  { id: 'gre', name: 'Grêmio',         short: 'GRE', c1: '#0d80bf', c2: '#111111', rating: 74 },
  { id: 'int', name: 'Internacional',  short: 'INT', c1: '#e5050f', c2: '#ffffff', rating: 74 },
  { id: 'cor', name: 'Corinthians',    short: 'COR', c1: '#111111', c2: '#ffffff', rating: 73 },
  { id: 'cru', name: 'Cruzeiro',       short: 'CRU', c1: '#0033a0', c2: '#ffffff', rating: 73 },
  { id: 'bah', name: 'Bahia',          short: 'BAH', c1: '#005eb8', c2: '#e30613', rating: 71 },
  { id: 'for', name: 'Fortaleza',      short: 'FOR', c1: '#00529f', c2: '#e30613', rating: 71 },
  { id: 'cap', name: 'Athletico-PR',   short: 'CAP', c1: '#c8102e', c2: '#111111', rating: 71 },
  { id: 'san', name: 'Santos',         short: 'SAN', c1: '#ffffff', c2: '#111111', rating: 70 },
  { id: 'vas', name: 'Vasco',          short: 'VAS', c1: '#111111', c2: '#ffffff', rating: 70 },
  { id: 'rbb', name: 'Bragantino',     short: 'RBB', c1: '#e30613', c2: '#ffffff', rating: 70 },
  { id: 'vit', name: 'Vitória',        short: 'VIT', c1: '#c8102e', c2: '#111111', rating: 66 },
  { id: 'cea', name: 'Ceará',          short: 'CEA', c1: '#111111', c2: '#ffffff', rating: 66 },
  { id: 'juv', name: 'Juventude',      short: 'JUV', c1: '#00843d', c2: '#ffffff', rating: 64 },
  { id: 'spo', name: 'Sport',          short: 'SPO', c1: '#c8102e', c2: '#111111', rating: 64 },
];

const FIRST = ['Gabriel','Lucas','Matheus','Pedro','João','Rafael','Bruno','Thiago','Felipe','Gustavo','Diego','Vinícius','Leandro','Caio','Rodrigo','Eduardo','Henrique','André','Marcelo','Fábio','Renan','Igor','Danilo','Wesley','Nathan','Yuri','Kauã','Murilo','Davi','Enzo','Otávio','Jonas','Everton','Ricardo','Willian','Douglas','Adriano','Paulo','Samuel','Victor','Arthur','Cauã','Breno','Tales','Jean','Ítalo','Luan','Marlon','Raul','Elias'];
const LAST = ['Silva','Santos','Oliveira','Souza','Lima','Pereira','Costa','Ferreira','Almeida','Ribeiro','Carvalho','Gomes','Martins','Rocha','Barbosa','Araújo','Cardoso','Nascimento','Moreira','Teixeira','Monteiro','Freitas','Mendes','Cavalcanti','Dias','Castro','Campos','Pinto','Machado','Correia','Nunes','Vieira','Borges','Azevedo','Rezende','Fonseca','Barros','Melo','Duarte','Farias','Lacerda','Peixoto','Brito','Xavier','Sampaio','Tavares'];

// ------------------------------------------------------------------ UTILS ---
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function poisson(rng, lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------------- ELENCOS ---
function makePlayer(id, name, pos, ovr, age) {
  return {
    id, name, pos, ovr, age,
    goals: 0, yellows: 0, totalYellows: 0, totalReds: 0,
    suspended: 0, injured: 0, injuryName: null,
  };
}

function generateSquad(team, seed) {
  const real = REAL_SQUADS[team.id];
  if (real) {
    return real.map(([name, pos, ovr, age], i) => makePlayer(`${team.id}-${i + 1}`, name, pos, ovr, age));
  }
  const rng = mulberry32(hashStr(team.id) ^ seed);
  const counts = { GK: 3, DEF: 7, MID: 7, ATT: 5 };
  const used = new Set();
  const players = [];
  let n = 1;
  for (const pos of POS) {
    const list = [];
    for (let i = 0; i < counts[pos]; i++) {
      let name;
      do { name = pick(rng, FIRST) + ' ' + pick(rng, LAST); } while (used.has(name));
      used.add(name);
      list.push(makePlayer('', name, pos, clamp(Math.round(team.rating + (rng() - 0.5) * 14), 38, 94), 18 + Math.floor(rng() * 18)));
    }
    list.sort((a, b) => b.ovr - a.ovr);
    // reservas são um pouco mais fracos que titulares
    list.forEach((p, idx) => { p.ovr = clamp(p.ovr - Math.floor(idx * 1.8), 36, 94); p.id = team.id + '-' + (n++); });
    players.push(...list);
  }
  return players;
}

const isUnavailable = p => (p.suspended || 0) > 0 || (p.injured || 0) > 0;

function ensurePlayers(world) {
  for (const t of Object.values(world.teams)) {
    for (const p of t.players) {
      if (p.yellows == null) p.yellows = 0;
      if (p.totalYellows == null) p.totalYellows = 0;
      if (p.totalReds == null) p.totalReds = 0;
      if (p.suspended == null) p.suspended = 0;
      if (p.injured == null) p.injured = 0;
      if (p.injuryName === undefined) p.injuryName = null;
    }
  }
}

function bestLineup(team, formation) {
  const need = FORMATIONS[formation];
  const avail = team.players.filter(p => !isUnavailable(p));
  const pool = avail.length >= 11 ? avail : team.players;
  const used = new Set();
  const ids = [];
  for (const pos of POS) {
    pool.filter(p => p.pos === pos && !used.has(p.id)).sort((a, b) => b.ovr - a.ovr)
      .slice(0, need[pos]).forEach(p => { ids.push(p.id); used.add(p.id); });
  }
  if (ids.length < 11) {
    // Se faltarem jogadores na posição ideal (por lesões/suspensões), completa com os melhores disponíveis
    const needGK = ids.filter(id => pool.find(p => p.id === id).pos === 'GK').length === 0;
    const rest = pool.filter(p => !used.has(p.id)).sort((a, b) => b.ovr - a.ovr);
    for (const p of rest) {
      if (ids.length >= 11) break;
      if (!needGK && p.pos === 'GK') continue;
      ids.push(p.id); used.add(p.id);
    }
    if (ids.length < 11) {
      for (const p of team.players.filter(x => !used.has(x.id)).sort((a, b) => b.ovr - a.ovr)) {
        if (ids.length >= 11) break;
        ids.push(p.id); used.add(p.id);
      }
    }
  }
  return ids;
}

// ------------------------------------------------------- FORÇA DO TIME -----
const ADJ = { DEF: { MID: 0.88, ATT: 0.75 }, MID: { DEF: 0.88, ATT: 0.88 }, ATT: { MID: 0.88, DEF: 0.75 } };
const W_ATT = { GK: 0, DEF: 0.2, MID: 0.6, ATT: 1.0 };
const W_DEF = { GK: 3.0, DEF: 1.0, MID: 0.5, ATT: 0.1 };

// Retorna {attack, defense, overall, slots:[{id, slot, penalty}]} ou {error}
function lineupStrength(team, lineupIds, formation) {
  const need = FORMATIONS[formation];
  if (!need) return { error: 'Formação inválida' };
  if (!Array.isArray(lineupIds) || lineupIds.length !== 11) return { error: 'Escolha exatamente 11 jogadores' };
  if (new Set(lineupIds).size !== 11) return { error: 'Jogador repetido na escalação' };
  const byId = new Map(team.players.map(p => [p.id, p]));
  const players = [];
  for (const id of lineupIds) {
    const p = byId.get(id);
    if (!p) return { error: 'Jogador não pertence ao seu time' };
    if (isUnavailable(p)) {
      return { error: `${p.name} está ${p.injured > 0 ? `lesionado (${p.injured} jogo${p.injured > 1 ? 's' : ''})` : `suspenso (${p.suspended} jogo${p.suspended > 1 ? 's' : ''})`}` };
    }
    players.push(p);
  }
  const hasAvailGK = team.players.some(p => p.pos === 'GK' && !isUnavailable(p));
  const gkCount = players.filter(p => p.pos === 'GK').length;
  if (hasAvailGK && gkCount !== 1) return { error: 'A escalação precisa ter exatamente 1 goleiro' };
  if (!hasAvailGK && gkCount > 1) return { error: 'No máximo 1 goleiro na escalação' };

  const remaining = { ...need };
  const slots = [];
  const unplaced = [];
  players.sort((a, b) => b.ovr - a.ovr).forEach(p => {
    if (remaining[p.pos] > 0) { remaining[p.pos]--; slots.push({ id: p.id, slot: p.pos, penalty: 1, ovr: p.ovr }); }
    else unplaced.push(p);
  });
  for (const p of unplaced) {
    let best = null;
    const targets = remaining.GK > 0 ? ['GK', 'DEF', 'MID', 'ATT'] : ['DEF', 'MID', 'ATT'];
    for (const pos of targets) {
      if (remaining[pos] > 0) {
        const pen = pos === 'GK' ? 0.5 : (ADJ[p.pos]?.[pos] || 0.5);
        if (!best || pen > best.pen) best = { pos, pen };
      }
    }
    remaining[best.pos]--;
    slots.push({ id: p.id, slot: best.pos, penalty: best.pen, ovr: p.ovr });
  }
  let a = 0, aw = 0, d = 0, dw = 0;
  for (const s of slots) {
    const e = s.ovr * s.penalty;
    a += e * W_ATT[s.slot]; aw += W_ATT[s.slot];
    d += e * W_DEF[s.slot]; dw += W_DEF[s.slot];
  }
  const nATT = need.ATT, nMID = need.MID, nDEF = need.DEF;
  const attack = a / aw + ((nATT + nMID * 0.4) - 3.6) * 1.2;
  const defense = d / dw + ((nDEF + nMID * 0.4) - 5.6) * 1.2;
  return {
    attack: +attack.toFixed(1),
    defense: +defense.toFixed(1),
    overall: +((attack + defense) / 2).toFixed(1),
    slots: slots.map(({ id, slot, penalty }) => ({ id, slot, penalty })),
  };
}

// Escalação usada no jogo: a do dono (se válida) ou substitui desfalques / automática
function lineupForMatch(team) {
  if (team.ownerId && team.lineup) {
    const s = lineupStrength(team, team.lineup, team.formation);
    if (!s.error) return { formation: team.formation, lineup: team.lineup, strength: s };
    // Se há jogador suspenso/lesionado na escalação salva, tenta substituir pelos melhores reservas disponíveis
    const byId = new Map(team.players.map(p => [p.id, p]));
    const validIds = team.lineup.filter(id => { const p = byId.get(id); return p && !isUnavailable(p); });
    if (validIds.length < team.lineup.length && team.lineup.length === 11) {
      const lu = team.lineup.slice();
      const used = new Set(validIds);
      const pool = team.players.filter(p => !used.has(p.id) && !isUnavailable(p)).sort((a, b) => b.ovr - a.ovr);
      let ok = true;
      for (let i = 0; i < lu.length; i++) {
        const old = byId.get(lu[i]);
        if (!old || isUnavailable(old)) {
          const candIdx = pool.findIndex(p => p.pos === old?.pos);
          const idx = candIdx >= 0 ? candIdx : pool.findIndex(p => p.pos !== 'GK');
          const pickIdx = idx >= 0 ? idx : 0;
          if (pool.length === 0) { ok = false; break; }
          const [cand] = pool.splice(pickIdx, 1);
          lu[i] = cand.id;
        }
      }
      if (ok) {
        const patched = lineupStrength(team, lu, team.formation);
        if (!patched.error) return { formation: team.formation, lineup: lu, strength: patched };
      }
    }
  }
  let best = null;
  for (const f of Object.keys(FORMATIONS)) {
    const lu = bestLineup(team, f);
    const s = lineupStrength(team, lu, f);
    if (!s.error && (!best || s.overall > best.strength.overall)) best = { formation: f, lineup: lu, strength: s };
  }
  return best;
}

// ------------------------------------------------ CARTÕES E LESÕES ----------
const YELLOW_PROB = { GK: 0.03, DEF: 0.22, MID: 0.19, ATT: 0.12 };
const SECOND_YELLOW_PROB = 0.04;
const DIRECT_RED_PROB = { GK: 0.004, DEF: 0.011, MID: 0.008, ATT: 0.006 };
const INJURY_PROB = { GK: 0.01, DEF: 0.032, MID: 0.032, ATT: 0.035 };
const INJURY_LIGHT = ['Pancada leve', 'Desgaste muscular', 'Cãibra forte'];
const INJURY_MED = ['Estiramento muscular', 'Entorse no tornozelo', 'Contusão na coxa'];
const INJURY_HEAVY = ['Lesão muscular grave', 'Torção no joelho', 'Fratura leve'];

function rollInjury(rng) {
  const r = rng();
  if (r < 0.55) return { rounds: 1, reason: pick(rng, INJURY_LIGHT) };
  if (r < 0.88) return { rounds: 2 + Math.floor(rng() * 2), reason: pick(rng, INJURY_MED) };
  return { rounds: 4 + Math.floor(rng() * 3), reason: pick(rng, INJURY_HEAVY) };
}

function rollDisciplineAndInjuries(team, lu, side, rng, cards, injuries) {
  const byId = new Map(team.players.map(p => [p.id, p]));
  const outAt = new Map();
  let redTime = 0;

  for (const id of lu.lineup) {
    const p = byId.get(id);
    let sentOffAt = null;

    if (rng() < YELLOW_PROB[p.pos]) {
      const m1 = 1 + Math.floor(rng() * 88);
      p.totalYellows = (p.totalYellows || 0) + 1;
      if (rng() < SECOND_YELLOW_PROB) {
        const m2 = m1 + 1 + Math.floor(rng() * (90 - m1));
        p.totalReds = (p.totalReds || 0) + 1;
        p.suspended = Math.max(p.suspended || 0, 1);
        sentOffAt = m2;
        cards.push({ m: m1, t: side, p: p.name, pid: p.id, type: 'Y' });
        cards.push({ m: m2, t: side, p: p.name, pid: p.id, type: 'YR' });
      } else {
        p.yellows = (p.yellows || 0) + 1;
        let susp = false;
        if (p.yellows >= 3) {
          p.yellows = 0;
          p.suspended = Math.max(p.suspended || 0, 1);
          susp = true;
        }
        cards.push({ m: m1, t: side, p: p.name, pid: p.id, type: 'Y', ...(susp ? { susp: true } : {}) });
      }
    } else if (rng() < DIRECT_RED_PROB[p.pos]) {
      const m = 5 + Math.floor(rng() * 85);
      p.totalReds = (p.totalReds || 0) + 1;
      p.suspended = Math.max(p.suspended || 0, 1);
      sentOffAt = m;
      cards.push({ m, t: side, p: p.name, pid: p.id, type: 'R' });
    }

    if (sentOffAt != null) {
      outAt.set(p.id, sentOffAt);
      redTime += (90 - sentOffAt) / 90;
    } else if (rng() < INJURY_PROB[p.pos]) {
      const m = 5 + Math.floor(rng() * 84);
      const inj = rollInjury(rng);
      p.injured = Math.max(p.injured || 0, inj.rounds);
      p.injuryName = inj.reason;
      outAt.set(p.id, m);
      injuries.push({ m, t: side, p: p.name, pid: p.id, rounds: inj.rounds, reason: inj.reason });
    }
  }
  return { outAt, redTime: Math.min(redTime, 1.8) };
}

// -------------------------------------------------------------- SIMULAÇÃO ---
function simulateMatch(home, away, rng) {
  const H = lineupForMatch(home), A = lineupForMatch(away);
  const cards = [], injuries = [];
  const dH = rollDisciplineAndInjuries(home, H, 'h', rng, cards, injuries);
  const dA = rollDisciplineAndInjuries(away, A, 'a', rng, cards, injuries);

  const K = 32;
  const redFactorH = (1 - 0.22 * dH.redTime) * (1 + 0.25 * dA.redTime);
  const redFactorA = (1 - 0.22 * dA.redTime) * (1 + 0.25 * dH.redTime);
  const xgH = clamp(1.12 * Math.exp((H.strength.attack - A.strength.defense) / K) * 1.12 * redFactorH, 0.2, 4.5);
  const xgA = clamp(1.12 * Math.exp((A.strength.attack - H.strength.defense) / K) / 1.06 * redFactorA, 0.2, 4.5);
  const hg = poisson(rng, xgH), ag = poisson(rng, xgA);

  const goals = [];
  const addGoals = (n, team, lu, side, outAt) => {
    const byId = new Map(team.players.map(p => [p.id, p]));
    const wPos = { GK: 0.02, DEF: 0.7, MID: 2.2, ATT: 5 };
    const pool = lu.lineup.map(id => byId.get(id));
    const weights = pool.map(p => wPos[p.pos] * p.ovr * ((outAt.get(p.id) || 90) / 90));
    const total = weights.reduce((s, w) => s + w, 0);
    for (let i = 0; i < n; i++) {
      let r = rng() * total, idx = 0;
      while (idx < pool.length - 1 && r > weights[idx]) { r -= weights[idx]; idx++; }
      const scorer = pool[idx];
      const maxMin = Math.max(1, outAt.get(scorer.id) || 90);
      scorer.goals++;
      goals.push({ m: 1 + Math.floor(rng() * maxMin), t: side, p: scorer.name, pid: scorer.id });
    }
  };
  addGoals(hg, home, H, 'h', dH.outAt);
  addGoals(ag, away, A, 'a', dA.outAt);
  goals.sort((x, y) => x.m - y.m);
  cards.sort((x, y) => x.m - y.m);
  injuries.sort((x, y) => x.m - y.m);
  return {
    hg, ag, goals, cards, injuries,
    hf: H.formation, af: A.formation,
    hs: Math.round(H.strength.overall), as: Math.round(A.strength.overall),
  };
}

// --------------------------------------------------------------- CALENDÁRIO -
// Próximos "n" horários de jogo (quartas e domingos) estritamente depois de ts
function slotsAfter(ts, n) {
  const out = [];
  const d = new Date(ts + BRT_OFFSET);
  let dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  while (out.length < n) {
    const dow = new Date(dayStart).getUTCDay();
    if (KICKOFF[dow]) {
      const [h, m] = KICKOFF[dow];
      const k = dayStart + (h * 60 + m) * 60000 - BRT_OFFSET;
      if (k > ts) out.push(k);
    }
    dayStart += 86400000;
  }
  return out;
}

// Pontos corridos, turno e returno (método do círculo)
function buildFixtures(teamIds, startTs, rng) {
  let ids = shuffle(rng, teamIds);
  const n = ids.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const matches = [];
    for (let i = 0; i < n / 2; i++) {
      let h = ids[i], a = ids[n - 1 - i];
      // alterna mando de campo (sem isso o time ficava 19 rodadas seguidas em casa e 19 fora)
      if (i === 0 ? r % 2 === 1 : i % 2 === 1) [h, a] = [a, h];
      matches.push({ h, a, done: false });
    }
    rounds.push(matches);
    ids = [ids[0], ids[n - 1], ...ids.slice(1, n - 1)];
  }
  const second = rounds.map(ms => ms.map(m => ({ h: m.a, a: m.h, done: false })));
  const all = [...rounds, ...second];
  const slots = slotsAfter(startTs, all.length);
  return all.map((matches, i) => ({ round: i + 1, kickoff: slots[i], done: false, matches }));
}

// ---------------------------------------------------------------- FINANÇAS --
// Valores em reais (inteiros). Calibrado para que, com preço padrão, os clubes
// fiquem perto do equilíbrio: os grandes lucram mais, os pequenos apertam.
const MIN_PRICE = 10, MAX_PRICE = 300;
const wageOf = ovr => Math.round(Math.pow(Math.max(ovr - 30, 0), 2) * 100);   // por rodada
const payroll = team => team.players.reduce((s, p) => s + wageOf(p.ovr), 0);
const capacityOf = t => Math.round((15000 + (t.rating - 55) * 1500) / 500) * 500;
const prefPrice = t => Math.round(40 + (t.rating - 60) * 2.5);                // preço "de referência" da torcida
const sponsorOf = t => Math.round((t.rating - 40) * 60000);                  // patrocínio + TV por rodada
const startCash = t => Math.round((5e6 + (t.rating - 50) * 5e5) / 1e5) * 1e5;

function formPts(team) {                                                      // pontos nos últimos 5 jogos (0-15)
  const f = team.form || [];
  return f.length ? (f.reduce((a, b) => a + b, 0) / f.length) * 5 : 7.5;
}
// Público esperado: torcida grande, mas sensível ao preço (elasticidade 1,2) e à fase do time.
function estimateAttendance(team, price, noise = 1) {
  const cap = capacityOf(team);
  const demand = cap * 1.35 * Math.pow(prefPrice(team) / price, 1.2) * (0.92 + 0.016 * formPts(team)) * noise;
  return Math.max(0, Math.round(Math.min(cap, demand)));
}
function initFinance(team) {
  if (team.cash == null) team.cash = startCash(team);
  if (team.ticketPrice == null) team.ticketPrice = prefPrice(team);
  if (!team.form) team.form = [];
  if (!team.fin) team.fin = [];
}
function ensureFinance(world) { for (const t of Object.values(world.teams)) initFinance(t); }

// Fecha o financeiro de uma rodada: bilheteria (mandante), patrocínio e salários (todos).
function settleFinance(world, fixture, rng) {
  const entries = {};
  for (const t of Object.values(world.teams)) {
    entries[t.id] = { s: world.season, r: fixture.round, home: false, att: 0, price: 0, gate: 0, sponsor: sponsorOf(t), wages: payroll(t) };
  }
  for (const m of fixture.matches) {
    const h = world.teams[m.h];
    const att = estimateAttendance(h, h.ticketPrice, 0.95 + rng() * 0.1);
    Object.assign(m, { att, price: h.ticketPrice, gate: att * h.ticketPrice });
    Object.assign(entries[h.id], { home: true, att, price: h.ticketPrice, gate: m.gate });
    const pts = (a, b) => (a > b ? 3 : a === b ? 1 : 0);
    h.form = [...(h.form || []), pts(m.hg, m.ag)].slice(-5);
    const a = world.teams[m.a];
    a.form = [...(a.form || []), pts(m.ag, m.hg)].slice(-5);
  }
  for (const t of Object.values(world.teams)) {
    const e = entries[t.id];
    e.net = e.gate + e.sponsor - e.wages;
    t.cash += e.net; e.cash = t.cash;
    t.fin = [...t.fin, e].slice(-40);
  }
}

// ---------------------------------------------------------------- MERCADO ---
// Troca entre treinadores humanos: proposta (dinheiro e/ou jogador) + aceite.
const WINDOWS = [[1, 5], [19, 24]];            // janelas: enquanto a próxima rodada estiver nesses intervalos
const SQUAD_MIN = 18, SQUAD_MAX = 28;
const POS_MIN = { GK: 2, DEF: 5, MID: 5, ATT: 3 };
const POS_PLURAL = { GK: 'goleiros', DEF: 'defensores', MID: 'meio-campistas', ATT: 'atacantes' };
const MAX_PENDING = 5;                          // propostas pendentes enviadas por clube
const MIN_OFFER_RATIO = 0.5;                    // oferta mínima: 50% do valor de mercado

function playerValue(p) {
  const ageF = p.age <= 23 ? 1.25 : p.age <= 28 ? 1 : p.age <= 31 ? 0.8 : 0.55;
  return Math.max(100000, Math.round(Math.pow(Math.max(p.ovr - 40, 0), 2) * 12000 * ageF / 100000) * 100000);
}
// Transfer ban: clube com caixa negativo não pode contratar (mas pode vender).
const isBanned = team => team.cash < 0;

function marketStatus(world, ts = Date.now()) {
  const f = nextFixture(world);
  if (!f) return { open: false, reason: 'none', windows: WINDOWS };
  const win = WINDOWS.find(([a, b]) => f.round >= a && f.round <= b);
  if (!win) {
    const nx = WINDOWS.find(([a]) => a > f.round) || WINDOWS[0];
    return { open: false, reason: 'window', round: f.round, nextWindow: nx, windows: WINDOWS };
  }
  const closesAt = f.kickoff - LOCK_MS;
  if (ts >= closesAt) return { open: false, reason: 'lock', round: f.round, windowEnd: win[1], windows: WINDOWS };
  return { open: true, round: f.round, windowEnd: win[1], closesAt, windows: WINDOWS };
}

function rosterError(team, outIds, inPlayers) {
  const list = team.players.filter(p => !outIds.includes(p.id)).concat(inPlayers);
  if (list.length < SQUAD_MIN) return `${team.name} ficaria com menos de ${SQUAD_MIN} jogadores`;
  if (list.length > SQUAD_MAX) return `${team.name} ficaria com mais de ${SQUAD_MAX} jogadores`;
  for (const pos of POS) {
    if (list.filter(p => p.pos === pos).length < POS_MIN[pos]) return `${team.name} precisa ter pelo menos ${POS_MIN[pos]} ${POS_PLURAL[pos]}`;
  }
  return null;
}

// Retorna mensagem de erro (string) ou null se a proposta é válida agora.
function validateOffer(world, o, ts = Date.now()) {
  const ms = marketStatus(world, ts);
  if (!ms.open) {
    return ms.reason === 'lock' ? 'Mercado fechado: faltam menos de 1h para a partida'
      : ms.reason === 'window' ? 'Fora da janela de transferências' : 'Mercado fechado';
  }
  const buyer = world.teams[o.from], seller = world.teams[o.to];
  if (!buyer || !seller || o.from === o.to) return 'Clubes inválidos';
  if (!buyer.ownerId || !seller.ownerId) return 'Só é possível negociar entre treinadores';
  if (isBanned(buyer)) return 'Transfer ban: o clube que contrata está com o caixa negativo';
  const want = seller.players.find(p => p.id === o.pid);
  if (!want) return 'Esse jogador não está mais no clube';
  const swap = o.swapPid ? buyer.players.find(p => p.id === o.swapPid) : null;
  if (o.swapPid && !swap) return 'O jogador oferecido não está mais no elenco';
  if (!Number.isInteger(o.money) || o.money < 0 || o.money > 1e9) return 'Valor inválido';
  if (o.money === 0 && !swap) return 'Ofereça dinheiro e/ou um jogador';
  if (buyer.cash < o.money) return `${buyer.name} não tem caixa para esse valor`;
  if (swap && isBanned(seller)) return `${seller.name} está em transfer ban e não pode receber jogadores`;
  if (o.money + (swap ? playerValue(swap) : 0) < playerValue(want) * MIN_OFFER_RATIO) return 'Oferta abaixo de 50% do valor de mercado';
  return rosterError(buyer, swap ? [swap.id] : [], [want]) || rosterError(seller, [want.id], swap ? [swap] : []);
}

// Troca o jogador removido da escalação por reserva da mesma posição (mantém o resto das escolhas do treinador).
function fixLineup(team, removed) {
  if (!team.lineup) return;
  const lu = team.lineup.slice();
  for (const rp of removed) {
    const idx = lu.indexOf(rp.id);
    if (idx < 0) continue;
    const avail = team.players.filter(p => !lu.includes(p.id) && !isUnavailable(p)).sort((a, b) => b.ovr - a.ovr);
    const pool = avail.length ? avail : team.players.filter(p => !lu.includes(p.id)).sort((a, b) => b.ovr - a.ovr);
    const cand = pool.find(p => p.pos === rp.pos) || pool[0];
    lu[idx] = cand.id;
  }
  const st = lineupStrength(team, lu, team.formation);
  team.lineup = st.error ? bestLineup(team, team.formation) : lu;
}

const playerSnap = p => ({
  id: p.id, name: p.name, pos: p.pos, ovr: p.ovr, age: p.age,
  value: playerValue(p), wage: wageOf(p.ovr),
  yellows: p.yellows || 0, totalYellows: p.totalYellows || 0, totalReds: p.totalReds || 0,
  suspended: p.suspended || 0, injured: p.injured || 0, injuryName: p.injuryName || null,
});

// Executa a troca (assume validateOffer == null). Atualiza caixas, elencos, escalações, ofertas e histórico.
function applyTransfer(world, o) {
  const buyer = world.teams[o.from], seller = world.teams[o.to];
  const want = seller.players.find(p => p.id === o.pid);
  const swap = o.swapPid ? buyer.players.find(p => p.id === o.swapPid) : null;
  seller.players = seller.players.filter(p => p !== want);
  buyer.players = buyer.players.filter(p => p !== swap);
  buyer.players.push(want);
  if (swap) seller.players.push(swap);
  buyer.cash -= o.money; seller.cash += o.money;
  fixLineup(seller, [want]);
  if (swap) fixLineup(buyer, [swap]);
  const moved = new Set([want.id, swap && swap.id].filter(Boolean));
  for (const x of world.offers) {
    if (x !== o && x.status === 'pending' && (moved.has(x.pid) || (x.swapPid && moved.has(x.swapPid)))) {
      x.status = 'expired'; x.resolvedAt = Date.now(); x.note = 'Jogador envolvido em outra transferência';
    }
  }
  const nf = nextFixture(world);
  world.transfers.push({
    at: Date.now(), season: world.season, round: nf ? nf.round : null,
    player: playerSnap(want), from: o.to, to: o.from, money: o.money, swap: swap ? playerSnap(swap) : null,
  });
  world.transfers = world.transfers.slice(-100);
  const resolved = world.offers.filter(x => x.status !== 'pending');
  if (resolved.length > 150) {
    const drop = new Set(resolved.slice(0, resolved.length - 150));
    world.offers = world.offers.filter(x => !drop.has(x));
  }
}
function ensureMarket(world) { world.offers = world.offers || []; world.transfers = world.transfers || []; }

// ----------------------------------------------------------------- MUNDO ----
function createWorld() {
  const seed = Math.floor(Math.random() * 1e9);
  const teams = {};
  for (const t of TEAMS) {
    const team = { ...t, ownerId: null, formation: '4-4-2', lineup: null };
    team.players = generateSquad(team, seed);
    initFinance(team);
    teams[t.id] = team;
  }
  return {
    version: 1,
    createdAt: Date.now(),
    season: 1,
    teams,
    users: {},
    sessions: {},
    fixtures: buildFixtures(TEAMS.map(t => t.id), Date.now(), Math.random),
    history: [],
    offers: [],
    transfers: [],
  };
}

function nextFixture(world) { return world.fixtures.find(f => !f.done) || null; }

function playRound(world, fixture, rng = Math.random) {
  ensurePlayers(world);
  // Guarda suspensões/lesões pré-existentes para descontar 1 rodada após os jogos (sem descontar as novas desta rodada)
  const prevOut = new Map();
  for (const t of Object.values(world.teams)) {
    for (const p of t.players) {
      if ((p.suspended || 0) > 0 || (p.injured || 0) > 0) {
        prevOut.set(p.id, { susp: p.suspended || 0, inj: p.injured || 0 });
      }
    }
  }
  for (const m of fixture.matches) {
    const res = simulateMatch(world.teams[m.h], world.teams[m.a], rng);
    Object.assign(m, res, { done: true });
  }
  for (const t of Object.values(world.teams)) {
    for (const p of t.players) {
      const prev = prevOut.get(p.id);
      if (!prev) continue;
      if (prev.susp > 0) p.suspended = Math.max(0, prev.susp - 1);
      if (prev.inj > 0) {
        p.injured = Math.max(0, prev.inj - 1);
        if (p.injured === 0) p.injuryName = null;
      }
    }
  }
  settleFinance(world, fixture, rng);
  fixture.done = true;
  fixture.playedAt = Date.now();
  if (world.fixtures.every(f => f.done)) endSeason(world);
}

function computeTable(world) {
  const rows = {};
  for (const id of Object.keys(world.teams)) rows[id] = { id, p: 0, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0 };
  for (const f of world.fixtures) for (const m of f.matches) {
    if (!m.done) continue;
    const H = rows[m.h], A = rows[m.a];
    H.j++; A.j++; H.gp += m.hg; H.gc += m.ag; A.gp += m.ag; A.gc += m.hg;
    if (m.hg > m.ag) { H.v++; H.p += 3; A.d++; }
    else if (m.hg < m.ag) { A.v++; A.p += 3; H.d++; }
    else { H.e++; A.e++; H.p++; A.p++; }
  }
  return Object.values(rows).map(r => ({ ...r, sg: r.gp - r.gc })).sort((x, y) =>
    y.p - x.p || y.v - x.v || y.sg - x.sg || y.gp - x.gp ||
    world.teams[x.id].name.localeCompare(world.teams[y.id].name));
}

function endSeason(world) {
  const table = computeTable(world);
  const scorers = topScorers(world, 1)[0] || null;
  world.history.push({ season: world.season, champion: table[0].id, topScorer: scorers, endedAt: Date.now() });
  const lastKick = world.fixtures[world.fixtures.length - 1].kickoff;
  world.season++;
  for (const t of Object.values(world.teams)) t.players.forEach(p => {
    p.goals = 0; p.yellows = 0; p.totalYellows = 0; p.totalReds = 0;
    p.suspended = 0; p.injured = 0; p.injuryName = null;
  });
  world.fixtures = buildFixtures(Object.keys(world.teams), lastKick + 3600 * 1000, Math.random);
}

function topScorers(world, limit = 15) {
  const all = [];
  for (const t of Object.values(world.teams)) for (const p of t.players) if (p.goals > 0)
    all.push({ name: p.name, team: t.id, teamName: t.name, goals: p.goals, pos: p.pos });
  return all.sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name)).slice(0, limit);
}

function cleanCpf(raw) {
  return String(raw || '').replace(/\D/g, '');
}
function isValidCpf(raw) {
  const d = cleanCpf(raw);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const digit = ((sum * 10) % 11) % 10;
    if (digit !== Number(d[len])) return false;
  }
  return true;
}

module.exports = {
  TEAMS, FORMATIONS, POS, LOCK_MS, KICKOFF,
  WINDOWS, SQUAD_MIN, SQUAD_MAX, POS_MIN, MAX_PENDING, MIN_OFFER_RATIO,
  playerValue, isBanned, marketStatus, rosterError, validateOffer, applyTransfer, playerSnap, ensureMarket,
  MIN_PRICE, MAX_PRICE, wageOf, payroll, capacityOf, prefPrice, sponsorOf, estimateAttendance, ensureFinance,
  createWorld, nextFixture, playRound, computeTable, topScorers,
  bestLineup, lineupStrength, lineupForMatch, simulateMatch, slotsAfter, buildFixtures,
  isUnavailable, ensurePlayers, cleanCpf, isValidCpf,
  mulberry32, generateSquad,
};
