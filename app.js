'use strict';
// =============================================================================
//  app.js - interface do jogo (JavaScript puro, sem frameworks)
// =============================================================================
const $ = s => document.querySelector(s);
const S = {
  token: localStorage.getItem('tk') || '',
  me: null, state: null, tab: 'home', clockOffset: 0,
  round: null, lu: null, teams: null,
};

// ---------------------------------------------------------------- utilidades
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => Date.now() + S.clockOffset;
function fmtMoney(v) {
  const a = Math.abs(v), sg = v < 0 ? '-' : '';
  if (a >= 1e6) return sg + 'R$ ' + (a / 1e6).toFixed(2).replace('.', ',') + ' mi';
  if (a >= 1e3) return sg + 'R$ ' + Math.round(a / 1e3) + ' mil';
  return sg + 'R$ ' + a;
}
const fmtInt = n => Number(n).toLocaleString('pt-BR');
const POS_LABEL = { GK: 'GOL', DEF: 'DEF', MID: 'MEI', ATT: 'ATA' };

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) { logout(true); }
  if (!r.ok) throw new Error(j.error || 'Erro de conexão');
  return j;
}
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = ''; }, 2600);
}
const fmtKick = ts => new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
}).format(ts).replace('.', '') + ' (Brasília)';
function fmtCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400);
  const hh = String(Math.floor(s % 86400 / 3600)).padStart(2, '0');
  const mm = String(Math.floor(s % 3600 / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return (d ? d + 'd ' : '') + `${hh}:${mm}:${ss}`;
}
function shield(t, size) {
  if (t.logo) {
    const st = size ? `style="width:${size}px;height:${size}px"` : '';
    return `<img class="shield-logo" ${st} src="${esc(t.logo)}" alt="${esc(t.short)}">`;
  }
  const sz = size ? `width:${size}px;height:${size}px;font-size:${Math.max(8, Math.round(size * 0.34))}px;border-width:${size < 26 ? 2 : 3}px;` : '';
  return `<span class="shield" style="${sz}background:${t.c1};border-color:${t.c2 || '#fff'};color:${isDark(t.c1) ? '#fff' : '#111'}">${esc(t.short)}</span>`;
}
function isDark(hex) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 < 150;
}
function logout(silent) {
  localStorage.removeItem('tk'); S.token = ''; S.me = null;
  if (!silent) toast('Você saiu');
  boot();
}

// ------------------------------------------------------------------ login ---
function fmtCpf(raw) {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}
function isValidCpf(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(d[len])) return false;
  }
  return true;
}
function viewAuth() {
  let mode = 'login';
  $('#app').innerHTML = `
  <div class="wrap auth">
    <h1>⚽ Liga <b>Brasil</b> Manager</h1>
    <p class="sub">Assuma um clube, monte seu time e dispute o campeonato com seus amigos.<br>Jogos às <b>quartas</b> e <b>domingos</b>.</p>
    <div class="card">
      <div class="tabs2"><button id="tl" class="on">Entrar</button><button id="tr">Criar conta</button></div>
      <label>Nome de treinador</label><input id="nm" maxlength="20" autocomplete="username">
      <div id="cpfw" class="hidden">
        <label>CPF <span class="muted">(1 clube por CPF)</span></label>
        <input id="cpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" autocomplete="off">
      </div>
      <label>Senha</label><input id="pw" type="password" autocomplete="current-password">
      <div class="err" id="er"></div>
      <button class="btn block" id="go">Entrar</button>
    </div>
  </div>`;
  const setMode = m => {
    mode = m;
    $('#tl').classList.toggle('on', m === 'login'); $('#tr').classList.toggle('on', m === 'register');
    $('#cpfw').classList.toggle('hidden', m !== 'register');
    $('#go').textContent = m === 'login' ? 'Entrar' : 'Criar conta e jogar';
    $('#er').textContent = '';
  };
  $('#tl').onclick = () => setMode('login'); $('#tr').onclick = () => setMode('register');
  $('#cpf').oninput = e => { e.target.value = fmtCpf(e.target.value); };
  const submit = async () => {
    $('#er').textContent = ''; $('#go').disabled = true;
    try {
      const body = { name: $('#nm').value, password: $('#pw').value };
      if (mode === 'register') {
        if (!isValidCpf($('#cpf').value)) throw new Error('CPF inválido');
        body.cpf = $('#cpf').value;
      }
      const r = await api(mode === 'login' ? '/login' : '/register', { method: 'POST', body });
      S.token = r.token; localStorage.setItem('tk', r.token);
      boot();
    } catch (e) { $('#er').textContent = e.message; }
    $('#go').disabled = false;
  };
  $('#go').onclick = submit;
  $('#pw').onkeydown = e => { if (e.key === 'Enter') submit(); };
  $('#cpf').onkeydown = e => { if (e.key === 'Enter') submit(); };
}

// ------------------------------------------------------ escolha do time -----
async function viewPickTeam() {
  const { teams } = await api('/teams');
  const sorted = teams.slice().sort((a, b) => b.strength - a.strength);
  $('#app').innerHTML = topbar() + `
  <div class="wrap">
    <h2>Escolha seu clube</h2>
    <p class="muted small">Times sem treinador são controlados pelo computador até alguém assumir. Você só pode escolher uma vez.</p>
    <div class="teamgrid">${sorted.map(t => `
      <div class="tcard ${t.owner ? 'taken' : ''}" data-id="${t.id}">
        ${shield(t)}<div class="nm">${esc(t.name)}</div>
        <div class="st">Força ${t.strength}</div>
        <div class="st">${t.owner ? '👤 ' + esc(t.owner) : '<span class="good">Disponível</span>'}</div>
      </div>`).join('')}</div>
  </div>`;
  document.querySelectorAll('.tcard:not(.taken)').forEach(el => el.onclick = () => {
    const t = teams.find(x => x.id === el.dataset.id);
    openModal(`<h2>Assumir o ${esc(t.name)}?</h2>
      <p class="muted">Você será o treinador do clube na liga inteira. Essa escolha não pode ser desfeita.</p>
      <div class="row"><button class="btn ghost" id="mc">Cancelar</button><button class="btn" id="mo">Assumir</button></div>`);
    $('#mc').onclick = closeModal;
    $('#mo').onclick = async () => {
      try { await api('/claim', { method: 'POST', body: { teamId: t.id } }); closeModal(); toast('Boa sorte, professor!'); boot(); }
      catch (e) { toast(e.message, true); closeModal(); viewPickTeam(); }
    };
  });
}

// ------------------------------------------------------------ estrutura -----
function topbar() {
  return `<div class="top"><span class="brand">⚽ Liga <b>Brasil</b></span><span class="sp"></span>
    <span class="who">${esc(S.me?.name || '')}</span><button class="linkbtn" id="lo">sair</button></div>`;
}
function openModal(html) {
  const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.classList.remove('hidden');
  m.onclick = e => { if (e.target === m) closeModal(); };
}
function closeModal() { $('#modal').classList.add('hidden'); }

const TABS = [['home', '🏠', 'Início'], ['lineup', '📋', 'Escalação'], ['squad', '👥', 'Elenco'], ['finance', '💰', 'Finanças'], ['market', '🔄', 'Mercado'], ['table', '🏆', 'Tabela'], ['rounds', '📅', 'Jogos']];
async function viewMain() {
  $('#app').innerHTML = topbar() + `<div class="wrap" id="content"></div>
    <nav class="nav">${TABS.map(([id, ic, lb]) => `<button data-t="${id}" class="${S.tab === id ? 'on' : ''}"><span class="ic">${ic}</span>${lb}</button>`).join('')}</nav>`;
  document.querySelectorAll('.nav button').forEach(b => b.onclick = () => { S.tab = b.dataset.t; viewMain(); });
  $('#lo').onclick = () => logout();
  await refreshState();
  const f = { home, lineup, squad, finance, market, table, rounds }[S.tab];
  await f();
}
async function refreshState() {
  const st = await api('/state');
  S.state = st; S.clockOffset = st.serverNow - Date.now();
}
const content = () => $('#content');
const myId = () => S.me.teamId;

// ------------------------------------------------------------------ início --
async function home() {
  const st = S.state, lock = st.lock;
  const mine = st.nextRound && st.nextRound.matches.find(m => m.h === myId() || m.a === myId());
  const row = st.table.find(r => r.id === myId());
  const lastMine = st.lastRound && st.lastRound.matches.find(m => m.h === myId() || m.a === myId());
  let html = '';

  if (st.history.length) {
    const h = st.history[st.history.length - 1];
    html += `<div class="card"><span class="badge">Temporada ${h.season}</span> Campeão: <b>${esc(h.championName)}</b> 🏆</div>`;
  }
  html += `<div class="card hl"><div class="row between"><h3>Próxima partida</h3><span class="badge">Rodada ${lock.round ?? '-'} / ${st.totalRounds}</span></div>`;
  if (mine) {
    const home = mine.h === myId();
    html += `${vsBlock(mine)}
      <div class="small muted" style="text-align:center">${home ? 'Em casa' : 'Fora de casa'} · ${fmtKick(lock.kickoff)}</div>
      <div class="countdown" id="cd"></div>
      <div id="lk" class="small" style="text-align:center;margin-top:4px"></div>
      <button class="btn block" style="margin-top:10px" id="gl">Ajustar escalação</button>`;
  } else html += '<p>Sem partida pendente.</p>';
  html += '</div>';

  if (lastMine) {
    html += `<div class="card"><h3>Último resultado · Rodada ${st.lastRound.round}</h3>${vsBlock(lastMine, true)}${goalsHtml(lastMine)}</div>`;
  }
  if (row) {
    html += `<div class="card"><h3>Sua campanha</h3>
      <div class="meter"><div><b>${row.pos}º</b>posição</div><div><b>${row.p}</b>pontos</div><div><b>${row.v}-${row.e}-${row.d}</b>V-E-D</div><div><b>${row.sg > 0 ? '+' : ''}${row.sg}</b>saldo</div></div></div>`;
  }
  try {
    const mt = await api('/myteam');
    const unavail = mt.players.filter(p => p.suspended > 0 || p.injured > 0);
    const pend = mt.players.filter(p => p.yellows === 2 && !p.suspended && !p.injured);
    if (unavail.length || pend.length) {
      html += `<div class="card" id="dmc" style="cursor:pointer"><div class="row between"><h3>Desfalques e Cartões</h3><span class="small muted">ver elenco ›</span></div>
        ${unavail.map(p => `<div class="small" style="margin-top:4px">${p.injured > 0 ? `🏥 <b>${esc(p.name)}</b> (${POS_LABEL[p.pos]}) — ${esc(p.injuryName || 'Lesionado')} (${p.injured} jogo${p.injured > 1 ? 's' : ''})` : `🟥 <b>${esc(p.name)}</b> (${POS_LABEL[p.pos]}) — Suspenso (${p.suspended} jogo${p.suspended > 1 ? 's' : ''})`}</div>`).join('')}
        ${pend.length ? `<div class="small muted" style="margin-top:6px">🟨🟨 Pendurados (2 amarelos): ${pend.map(p => esc(p.name)).join(', ')}</div>` : ''}
      </div>`;
    }
  } catch {}
  try {
    const fin = await api('/finance');
    html += `<div class="card" id="cxc" style="cursor:pointer"><div class="row between"><h3>Caixa</h3><span class="small muted">ver finanças ›</span></div>
      <div class="bignum ${fin.cash < 0 ? 'bad' : 'good'}">${fmtMoney(fin.cash)}</div></div>`;
  } catch {}
  try {
    const mk = await api('/market'), st2 = mk.status;
    html += `<div class="card" id="mkc" style="cursor:pointer"><div class="row between"><h3>Mercado</h3>${marketBadge(st2)}</div>
      ${mk.incoming ? `<p style="margin:6px 0 0"><b>${mk.incoming}</b> proposta${mk.incoming > 1 ? 's' : ''} aguardando sua resposta ›</p>` : '<p class="small muted" style="margin:6px 0 0">Nenhuma proposta pendente.</p>'}
      ${mk.banned ? '<p style="margin:6px 0 0"><span class="badge lock">🚫 Transfer ban: caixa negativo</span></p>' : ''}</div>`;
  } catch {}
  content().innerHTML = html;
  const dmc = $('#dmc'); if (dmc) dmc.onclick = () => { S.tab = 'squad'; viewMain(); };
  const mkc = $('#mkc'); if (mkc) mkc.onclick = () => { S.tab = 'market'; viewMain(); };
  const cxc = $('#cxc'); if (cxc) cxc.onclick = () => { S.tab = 'finance'; viewMain(); };
  const gl = $('#gl'); if (gl) gl.onclick = () => { S.tab = 'lineup'; viewMain(); };
  tickCountdown();
}
function vsBlock(m, showScore) {
  const mid = showScore ? `<div class="score">${m.hg} x ${m.ag}</div>` : '<div class="score muted">x</div>';
  return `<div class="vs"><div>${teamShield(m.h)}<div>${esc(m.hn)}</div></div>${mid}<div>${teamShield(m.a)}<div>${esc(m.an)}</div></div></div>`;
}
function teamShield(id, size) {
  const t = TEAM_COLORS[id] || { id, c1: '#444', c2: '#fff', short: id };
  return shield(t, size);
}
const TEAM_COLORS = {};
function matchEvents(m) {
  const ev = [];
  for (const g of (m.goals || [])) ev.push({ m: g.m, k: 0, html: `${g.m}' ⚽ <b>${esc(g.p)}</b> <span class="muted">(${g.t === 'h' ? esc(m.hs) : esc(m.as)})</span>` });
  for (const c of (m.cards || [])) {
    const ic = c.type === 'Y' ? '🟨' : c.type === 'YR' ? '🟨🟥' : '🟥';
    const note = c.type !== 'Y' ? ' <span class="bad">(expulso)</span>' : c.susp ? ' <span class="bad">(3º🟨 susp.)</span>' : '';
    ev.push({ m: c.m, k: 1, html: `${c.m}' ${ic} ${esc(c.p)} <span class="muted">(${c.t === 'h' ? esc(m.hs) : esc(m.as)})</span>${note}` });
  }
  for (const j of (m.injuries || [])) {
    ev.push({ m: j.m, k: 2, html: `${j.m}' 🏥 ${esc(j.p)} <span class="muted">(${j.t === 'h' ? esc(m.hs) : esc(m.as)})</span> — ${esc(j.reason)} (${j.rounds}j)` });
  }
  return ev.sort((a, b) => a.m - b.m || a.k - b.k);
}
function goalsHtml(m) {
  const ev = matchEvents(m);
  if (!ev.length) return '<div class="small muted" style="text-align:center">Sem gols ou ocorrências</div>';
  return `<div class="goals" style="display:block;text-align:center">${ev.map(e => `<div>${e.html}</div>`).join('')}</div>`;
}
function tickCountdown() {
  clearInterval(tickCountdown.i);
  const run = () => {
    const el = $('#cd'); if (!el) return clearInterval(tickCountdown.i);
    const lk = S.state.lock, t = now();
    el.textContent = fmtCountdown(lk.kickoff - t);
    const l = $('#lk');
    if (lk.lockAt - t > 0) l.innerHTML = `<span class="badge warn">Escalação aberta</span> trava em ${fmtCountdown(lk.lockAt - t)}`;
    else l.innerHTML = '<span class="badge lock">🔒 Escalação travada</span> aguardando o apito inicial';
    if (lk.kickoff - t < -20000 && !run.busy) { run.busy = true; setTimeout(async () => { await refreshState(); if (S.tab === 'home') home(); run.busy = false; }, 3000); }
  };
  run(); tickCountdown.i = setInterval(run, 1000);
}

// ------------------------------------------------------------- escalação ----
async function lineup() {
  const d = await api('/myteam');
  S.lu = { formation: d.formation, ids: d.lineup.slice(), players: d.players, formations: d.formations, lock: d.lock, sel: null, prev: d.strength, saved: JSON.stringify([d.formation, d.lineup]) };
  drawLineup();
  tickLock();
}
function lockedNow() { const l = S.lu.lock; return l.locked || (l.lockAt && now() >= l.lockAt); }
function isUnavail(p) { return (p.suspended || 0) > 0 || (p.injured || 0) > 0; }
function playerTag(p) {
  if (p.injured > 0) return `🏥 ${p.injured}j`;
  if (p.suspended > 0) return `🟥 ${p.suspended}j`;
  if (p.yellows === 2) return '🟨🟨';
  if (p.yellows === 1) return '🟨';
  return '';
}
function shortName(name) {
  const s = String(name || '').trim();
  if (s.length <= 12) return s;
  const parts = s.split(/\s+/);
  return parts.length >= 2 ? parts[0][0] + '. ' + parts[parts.length - 1] : s;
}
function drawLineup() {
  const L = S.lu, byId = Object.fromEntries(L.players.map(p => [p.id, p]));
  const locked = lockedNow();
  const prev = L.prev || {};
  const lines = { ATT: [], MID: [], DEF: [], GK: [] };
  if (prev.slots) prev.slots.forEach(s => lines[s.slot].push({ p: byId[s.id], pen: s.penalty }));
  else L.ids.forEach(id => { const p = byId[id]; if (p) lines[p.pos].push({ p, pen: 1 }); }); // escalação inválida: agrupa pela posição natural
  const chip = (p, pen) => {
    const un = isUnavail(p), tag = playerTag(p);
    return `<div class="chip ${L.sel === p.id ? 'sel' : ''} ${un ? 'unavail' : pen < 1 ? 'off' : ''}" data-id="${p.id}">
      <span class="n">${esc(shortName(p.name))}</span><span class="o">${p.ovr}</span><span class="p">${POS_LABEL[p.pos]}${pen < 1 ? ' ⚠' : ''}${tag ? ' ' + tag : ''}</span></div>`;
  };
  const bench = L.players.filter(p => !L.ids.includes(p.id))
    .sort((a, b) => (isUnavail(a) - isUnavail(b)) || b.ovr - a.ovr);
  const dirty = JSON.stringify([L.formation, L.ids]) !== L.saved;

  content().innerHTML = `
    <div class="card">
      <div class="row between"><h2>Escalação</h2><span id="lkb"></span></div>
      <label>Formação</label>
      <select id="fm" ${locked ? 'disabled' : ''}>${L.formations.map(f => `<option ${f === L.formation ? 'selected' : ''}>${f}</option>`).join('')}</select>
      ${prev.error ? `<div class="err">${esc(prev.error)}</div>` : `<div class="meter"><div><b>${prev.attack ?? '-'}</b>ataque</div><div><b>${prev.defense ?? '-'}</b>defesa</div><div><b>${prev.overall ?? '-'}</b>geral</div></div>`}
      <p class="small muted">Toque em um titular e depois em um reserva (ou outro titular) para trocar. ⚠ fora de posição · 🏥 lesionado · 🟥 suspenso · 🟨🟨 pendurado.</p>
      <div class="pitch">${['ATT', 'MID', 'DEF', 'GK'].map(k => `<div class="pline">${lines[k].map(x => chip(x.p, x.pen)).join('')}</div>`).join('')}</div>
    </div>
    <div class="card"><h3>Reservas (${bench.length})</h3>
      <div class="bench">${bench.map(p => chip(p, 1)).join('')}</div></div>
    <div class="sticky-save row">
      <button class="btn ghost" id="au" ${locked ? 'disabled' : ''}>⚡ Automático</button>
      <button class="btn block" id="sv" ${locked || prev.error || !dirty ? 'disabled' : ''}>${dirty ? 'Salvar escalação' : 'Salva ✓'}</button>
    </div>`;
  updateLockBadge();
  if (locked) return;
  $('#fm').onchange = async e => {
    L.formation = e.target.value;
    const a = await api('/auto?formation=' + encodeURIComponent(L.formation));
    L.ids = a.lineup; L.sel = null; await preview();
  };
  document.querySelectorAll('.chip').forEach(c => c.onclick = async () => {
    const id = c.dataset.id, p = byId[id], inXI = L.ids.includes(id);
    if (!inXI && isUnavail(p)) {
      return toast(`${p.name} está ${p.injured > 0 ? `lesionado (${p.injured}j)` : `suspenso (${p.suspended}j)`}`, true);
    }
    if (L.sel && L.sel !== id) {
      const selIn = L.ids.includes(L.sel);
      if (selIn !== inXI) { // um titular e um reserva: troca
        const out = selIn ? L.sel : id, inn = selIn ? id : L.sel;
        L.ids = L.ids.map(x => x === out ? inn : x); L.sel = null; return preview();
      }
    }
    L.sel = L.sel === id ? null : id; drawLineup();
  });
  $('#au').onclick = async () => { const a = await api('/auto?formation=' + encodeURIComponent(L.formation)); L.ids = a.lineup; L.sel = null; preview(); };
  $('#sv').onclick = async () => {
    try {
      const r = await api('/lineup', { method: 'POST', body: { formation: L.formation, lineup: L.ids } });
      L.prev = r.strength; L.saved = JSON.stringify([L.formation, L.ids]); toast('Escalação salva ✓'); drawLineup();
    } catch (e) { toast(e.message, true); }
  };
}
async function preview() {
  const L = S.lu;
  L.prev = await api('/preview', { method: 'POST', body: { formation: L.formation, lineup: L.ids } });
  drawLineup();
}
function updateLockBadge() {
  const b = $('#lkb'); if (!b) return;
  const l = S.lu.lock;
  if (!l.lockAt) { b.innerHTML = ''; return; }
  const left = l.lockAt - now();
  b.innerHTML = left > 0 ? `<span class="badge warn">trava em ${fmtCountdown(left)}</span>` : '<span class="badge lock">🔒 travada</span>';
  if (left <= 0 && !S.lu.wasLocked) { S.lu.wasLocked = true; drawLineup(); }
}
function tickLock() { clearInterval(tickLock.i); tickLock.i = setInterval(() => { if (S.tab !== 'lineup') return clearInterval(tickLock.i); updateLockBadge(); }, 1000); }

// ----------------------------------------------------------------- elenco ---
function statusLine(p) {
  const parts = [];
  if (p.injured > 0) parts.push(`<span class="bad">🏥 ${esc(p.injuryName || 'Lesionado')} (${p.injured}j)</span>`);
  if (p.suspended > 0) parts.push(`<span class="bad">🟥 Suspenso (${p.suspended}j)</span>`);
  if (p.yellows === 2 && !p.suspended) parts.push('<span class="warn-txt">🟨🟨 Pendurado</span>');
  return parts.length ? `<div class="small">${parts.join(' · ')}</div>` : '';
}
function playersTable(players) {
  return `<div class="tablewrap"><table><tr><th class="l">Jogador</th><th>Pos</th><th>Id.</th><th>Força</th><th>🟨</th><th>🟥</th><th>Gols</th><th>Sal./rod.</th></tr>
    ${players.map(p => `<tr><td class="l" style="white-space:normal">${esc(p.name)}${statusLine(p)}</td><td>${POS_LABEL[p.pos]}</td><td>${p.age}</td><td><b>${p.ovr}</b></td><td>${p.totalYellows || 0}</td><td>${p.totalReds || 0}</td><td>${p.goals}</td><td class="small">${fmtMoney(p.wage)}</td></tr>`).join('')}</table></div>`;
}
async function squad() {
  const d = await api('/team/' + myId());
  content().innerHTML = `<div class="card"><div class="row" style="margin-bottom:8px">${teamShield(myId(), 42)}<div><h2 style="margin:0">${esc(d.team.name)}</h2><p class="muted small" style="margin:2px 0 0">${d.players.length} jogadores · força do time titular ${Math.round(d.strength.overall)}</p></div></div>${playersTable(d.players)}</div>`;
}
async function openTeam(id) {
  const d = await api('/team/' + id);
  const last = d.results.slice(-5).reverse();
  openModal(`<div class="row">${teamShield(id)}<div><h2 style="margin:0">${esc(d.team.name)}</h2><div class="small muted">${d.team.owner ? 'Treinador: ' + esc(d.team.owner) : 'Controlado pelo computador'} · força ${Math.round(d.strength.overall)}</div></div></div>
    ${last.length ? `<h3 style="margin-top:12px">Últimos jogos</h3>` + last.map(m => `<div class="small">R${m.round}: ${esc(m.hs)} <b>${m.hg} x ${m.ag}</b> ${esc(m.as)}</div>`).join('') : ''}
    <h3 style="margin-top:12px">Elenco</h3>${playersTable(d.players)}`);
}


// --------------------------------------------------------------- finanças ---
async function finance() {
  const d = await api('/finance');
  const lg = await api('/finance/league');
  S.fin = { d, lg: lg.rows, price: d.ticketPrice, saved: d.ticketPrice, prev: null };
  drawFinance();
  previewPrice(true);
}
function finLocked() { const l = S.fin.d.lock; return !l.lockAt ? false : (l.locked || now() >= l.lockAt); }
function drawFinance() {
  const F = S.fin, d = F.d, locked = finLocked();
  const fixo = d.sponsor - d.wages;
  const form = d.form.map(p => `<span class="fm f${p}">${p === 3 ? 'V' : p === 1 ? 'E' : 'D'}</span>`).join('');
  const se = d.season;
  content().innerHTML = `
  <div class="card hl"><h3>Caixa do clube</h3>
    <div class="bignum ${d.cash < 0 ? 'bad' : 'good'}">${fmtMoney(d.cash)}</div>
    ${d.cash < 0 ? '<span class="badge lock">🚫 Transfer ban: não pode contratar enquanto o caixa estiver negativo</span>' : ''}
    <table style="margin-top:8px">
      <tr><td class="l">Patrocínio + TV por rodada</td><td class="good">+${fmtMoney(d.sponsor)}</td></tr>
      <tr><td class="l">Folha salarial por rodada</td><td class="bad">-${fmtMoney(d.wages)}</td></tr>
      <tr><td class="l"><b>Saldo fixo (sem bilheteria)</b></td><td class="${fixo < 0 ? 'bad' : 'good'}"><b>${fmtMoney(fixo)}</b></td></tr>
    </table>
    <p class="small muted">${fixo < 0 ? 'A bilheteria dos jogos em casa precisa cobrir a diferença.' : 'Seus custos fixos estão cobertos.'}</p>
  </div>

  <div class="card"><div class="row between"><h3>Preço do ingresso</h3><span id="fl"></span></div>
    <p class="small muted" style="margin-top:0">${d.nextHome ? `Próxima partida <b>em casa</b> contra ${esc(d.nextOpponent || '')}.` : `Próxima partida <b>fora</b> de casa (sem bilheteria agora). O preço vale para o próximo jogo em casa.`}
      Capacidade: ${fmtInt(d.capacity)} · preço de referência da torcida: R$ ${d.refPrice}${form ? ' · fase: ' + form : ''}</p>
    <div class="row"><input type="range" id="pr" min="${d.minPrice}" max="${d.maxPrice}" step="1" value="${F.price}" ${locked ? 'disabled' : ''}>
      <input type="number" id="pn" min="${d.minPrice}" max="${d.maxPrice}" value="${F.price}" style="width:96px" ${locked ? 'disabled' : ''}></div>
    <div id="pv" class="meter"><div><b>-</b>público</div><div><b>-</b>ocupação</div><div><b>-</b>renda</div></div>
    <p class="small muted">Preço baixo enche o estádio mas rende pouco; preço alto afasta a torcida. Existe um ponto ideal, e ele muda com a fase do time. O público real varia cerca de ±5%.</p>
    <button class="btn block" id="ps" disabled>Salvar preço</button>
  </div>

  <div class="card"><h3>Temporada ${S.state.season} (${se.games} rodadas)</h3>
    <table>
      <tr><td class="l">Bilheteria</td><td class="good">${fmtMoney(se.gate)}</td></tr>
      <tr><td class="l">Patrocínio + TV</td><td class="good">${fmtMoney(se.sponsor)}</td></tr>
      <tr><td class="l">Salários</td><td class="bad">-${fmtMoney(se.wages)}</td></tr>
      <tr><td class="l"><b>Resultado</b></td><td class="${se.net < 0 ? 'bad' : 'good'}"><b>${fmtMoney(se.net)}</b></td></tr>
    </table>
  </div>

  <div class="card"><h3>Últimas rodadas</h3>${d.log.length ? `<div class="tablewrap"><table class="fintable">
    <tr><th>Rod.</th><th>Público</th><th>Bilheteria</th><th>Saldo</th><th>Caixa</th></tr>
    ${d.log.map(e => `<tr><td>${e.r}</td><td>${e.home ? fmtInt(e.att) : '<span class="muted">fora</span>'}</td><td>${e.home ? fmtMoney(e.gate) : '-'}</td>
      <td class="${e.net < 0 ? 'bad' : 'good'}">${fmtMoney(e.net)}</td><td>${fmtMoney(e.cash)}</td></tr>`).join('')}</table></div>` : '<p class="muted">Nenhuma rodada jogada ainda.</p>'}</div>

  <div class="card"><h3>Caixa dos clubes</h3><div class="tablewrap"><table>
    ${F.lg.map((r, i) => `<tr class="${r.id === myId() ? 'me' : ''}"><td>${i + 1}</td><td class="l"><span class="tinline">${teamShield(r.id, 18)}<span>${esc(r.name)}${r.owner ? ' <span class="muted small">· ' + esc(r.owner) + '</span>' : ''}</span></span></td><td class="${r.cash < 0 ? 'bad' : ''}">${fmtMoney(r.cash)}</td></tr>`).join('')}</table></div></div>`;
  updateFinLock();
  if (locked) return;
  const setPrice = v => {
    v = Math.max(d.minPrice, Math.min(d.maxPrice, Math.round(Number(v) || d.minPrice)));
    F.price = v; $('#pr').value = v; $('#pn').value = v;
    $('#ps').disabled = v === F.saved; $('#ps').textContent = v === F.saved ? 'Preço salvo ✓' : 'Salvar preço';
    previewPrice();
  };
  $('#pr').oninput = e => setPrice(e.target.value);
  $('#pn').onchange = e => setPrice(e.target.value);
  $('#ps').textContent = 'Preço salvo ✓';
  $('#ps').onclick = async () => {
    try { await api('/ticket', { method: 'POST', body: { price: F.price } }); F.saved = F.price; d.ticketPrice = F.price; toast('Preço salvo ✓'); setPrice(F.price); }
    catch (e) { toast(e.message, true); }
  };
}
function previewPrice(now0) {
  clearTimeout(previewPrice.t);
  const run = async () => {
    const F = S.fin; if (!F || S.tab !== 'finance') return;
    try {
      const r = await api('/finance/preview?price=' + F.price);
      const el = $('#pv'); if (!el) return;
      const pct = Math.round(r.attendance / r.capacity * 100);
      el.innerHTML = `<div><b>${fmtInt(r.attendance)}</b>público</div><div><b>${pct}%</b>ocupação</div><div><b>${fmtMoney(r.gate)}</b>renda</div>`;
    } catch {}
  };
  if (now0) run(); else previewPrice.t = setTimeout(run, 200);
}
function updateFinLock() {
  const b = $('#fl'), l = S.fin.d.lock; if (!b) return;
  if (!l.lockAt) return;
  const left = l.lockAt - now();
  b.innerHTML = left > 0 ? `<span class="badge warn">trava em ${fmtCountdown(left)}</span>` : '<span class="badge lock">🔒 travado</span>';
}


// ----------------------------------------------------------------- mercado --
function marketBadge(st) {
  if (st.open) return '<span class="badge ok">Janela aberta</span>';
  return st.reason === 'lock' ? '<span class="badge lock">🔒 Fechado</span>' : '<span class="badge warn">Janela fechada</span>';
}
const pdesc = p => `${POS_LABEL[p.pos]} ${p.ovr} · ${p.age} anos`;
async function market() {
  const prevView = S.mk && S.mk.viewId;
  const [m, o] = await Promise.all([api('/market'), api('/market/offers')]);
  S.mk = { m, o, viewId: prevView && m.teams.some(t => t.id === prevView) ? prevView : null, view: null, mine: null };
  if (S.mk.viewId) { try { S.mk.view = await api('/market/team/' + S.mk.viewId); } catch { S.mk.viewId = null; } }
  drawMarket();
  clearInterval(market.i);
  market.i = setInterval(() => {
    if (S.tab !== 'market') return clearInterval(market.i);
    const st = S.mk.m.status, el = $('#mkcd'); if (!st.open || !el) return;
    const left = st.closesAt - now();
    if (left <= 0) { clearInterval(market.i); market(); } else el.textContent = fmtCountdown(left);
  }, 1000);
}
function offerLine(o, role) {
  const w = o.want, sw = o.swap;
  const give = fmtMoney(o.money) + (sw ? ` + <b>${esc(sw.name)}</b> (${pdesc(sw)})` : '');
  return role === 'in'
    ? `<b>${esc(o.fromName)}</b> <span class="muted">(${esc(o.fromOwner)})</span> quer <b>${esc(w.name)}</b> (${pdesc(w)}, valor ${fmtMoney(w.value)}) e oferece ${give}`
    : `Você ofereceu ${give} por <b>${esc(w.name)}</b> (${pdesc(w)}, valor ${fmtMoney(w.value)}) do <b>${esc(o.toName)}</b>`;
}
const STATUS_TXT = { accepted: '✅ aceita', rejected: '❌ recusada', cancelled: '↩️ cancelada', expired: '⌛ expirada' };
function drawMarket() {
  const { m, o, view } = S.mk, st = m.status, L = m.limits;
  const canTrade = st.open && !m.banned;
  let when;
  if (st.open) when = `Vale até a rodada ${st.windowEnd}. Fecha 1h antes da partida (<b id="mkcd">${fmtCountdown(st.closesAt - now())}</b>).`;
  else if (st.reason === 'lock') when = 'Faltam menos de 1h para a partida. Reabre depois do jogo.';
  else if (st.reason === 'window') {
    const nw = st.nextWindow;
    when = nw[0] > st.round ? `Próxima janela: rodadas ${nw[0]} a ${nw[1]} (faltam ${nw[0] - st.round} rodadas).` : `Próxima janela: rodadas ${nw[0]} a ${nw[1]} da próxima temporada.`;
  } else when = 'Sem rodada pendente.';

  let h = `<div class="card ${st.open ? 'hl' : ''}"><div class="row between"><h2>Janela de transferências</h2>${marketBadge(st)}</div>
    <p class="small" style="margin:0 0 6px">${when}</p>
    <p class="small muted" style="margin:0">Janelas: rodadas ${st.windows.map(w => w[0] + ' a ' + w[1]).join(' e ')}. Elenco de ${L.min} a ${L.max} jogadores (mín. ${L.posMin.GK} goleiros, ${L.posMin.DEF} defensores, ${L.posMin.MID} meias, ${L.posMin.ATT} atacantes). Você tem ${m.squadSize}. Oferta mínima: ${Math.round(L.minRatio * 100)}% do valor de mercado. Até ${L.maxPending} propostas pendentes.</p></div>`;

  if (m.banned) h += `<div class="card" style="border-color:var(--bad)"><h2 class="bad">🚫 Transfer ban</h2>
    <p style="margin:0">Seu caixa está negativo (<b class="bad">${fmtMoney(m.cash)}</b>). Você <b>pode vender</b> jogadores, mas <b>não pode contratar</b> nem receber jogadores em trocas até o caixa ficar positivo. Ajuste o preço do ingresso ou venda alguém.</p></div>`;

  h += `<div class="card"><h3>Propostas recebidas (${o.incoming.length})</h3>${o.incoming.length ? o.incoming.map(x => `
    <div class="offer"><div>${offerLine(x, 'in')}</div>
      <div class="row" style="margin-top:8px"><button class="btn sm" data-acc="${x.id}">Aceitar</button><button class="btn sm ghost" data-rej="${x.id}">Recusar</button></div></div>`).join('') : '<p class="muted small" style="margin:0">Nenhuma proposta para você.</p>'}</div>`;

  h += `<div class="card"><h3>Propostas enviadas (${o.outgoing.length}/${L.maxPending})</h3>${o.outgoing.length ? o.outgoing.map(x => `
    <div class="offer"><div>${offerLine(x, 'out')}</div>
      <div class="row" style="margin-top:8px"><button class="btn sm ghost" data-can="${x.id}">Cancelar proposta</button></div></div>`).join('') : '<p class="muted small" style="margin:0">Nenhuma proposta enviada.</p>'}</div>`;

  h += `<div class="card"><h3>Fazer proposta</h3>`;
  if (!m.teams.length) h += '<p class="muted small" style="margin:0">Ainda não há outros treinadores na liga. Convide seus amigos pelo link!</p>';
  else {
    h += `<div class="chips">${m.teams.map(t => `<button class="pill ${S.mk.viewId === t.id ? 'on' : ''}" data-team="${t.id}">${esc(t.short)} · ${esc(t.owner)}${t.banned ? ' 🚫' : ''}</button>`).join('')}</div>`;
    if (view) {
      h += `<p class="small muted" style="margin:8px 0">${esc(view.team.name)} · treinador ${esc(view.team.owner)} · caixa ${fmtMoney(view.cash)}${view.banned ? ' · 🚫 em transfer ban (não aceita troca de jogadores)' : ''}</p>
      <div class="tablewrap"><table class="mktable"><tr><th class="l">Jogador</th><th>Pos</th><th>Força</th><th>Valor</th><th></th></tr>
      ${view.players.map(p => `<tr><td class="l">${esc(p.name)}<div class="muted">${p.age} anos${playerTag(p) ? ' · ' + playerTag(p) : ''}</div></td><td>${POS_LABEL[p.pos]}</td><td><b>${p.ovr}</b></td><td>${fmtMoney(p.value)}</td>
        <td><button class="btn sm" data-buy="${p.id}" ${canTrade ? '' : 'disabled'}>Propor</button></td></tr>`).join('')}</table></div>`;
    } else h += '<p class="small muted" style="margin:8px 0 0">Escolha um clube para ver o elenco.</p>';
    if (!canTrade) h += `<p class="small muted">${m.banned ? 'Você está em transfer ban.' : 'O mercado está fechado.'} Não é possível enviar propostas agora.</p>`;
  }
  h += '</div>';

  h += `<div class="card"><h3>Últimas transferências</h3>${m.transfers.length ? m.transfers.map(x => `
    <div class="small" style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,.07)"><span class="muted">T${x.season} R${x.round ?? '-'}</span> <b>${esc(x.player.name)}</b> (${pdesc(x.player)}) · ${esc(x.fromShort)} → ${esc(x.toShort)} · ${fmtMoney(x.money)}${x.swap ? ` + ${esc(x.swap.name)} (${pdesc(x.swap)})` : ''}</div>`).join('') : '<p class="muted small" style="margin:0">Nenhuma transferência ainda.</p>'}</div>`;

  if (o.history.length) h += `<div class="card"><h3>Minhas propostas encerradas</h3>${o.history.map(x => `
    <div class="small" style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,.07)">${STATUS_TXT[x.status] || x.status} · ${esc(x.want.name)} · ${esc(x.fromName)} → ${esc(x.toName)} · ${fmtMoney(x.money)}${x.swap ? ' + ' + esc(x.swap.name) : ''}${x.note ? ' <span class="muted">(' + esc(x.note) + ')</span>' : ''}</div>`).join('')}</div>`;

  content().innerHTML = h;

  document.querySelectorAll('[data-team]').forEach(b => b.onclick = async () => {
    S.mk.viewId = b.dataset.team;
    try { S.mk.view = await api('/market/team/' + S.mk.viewId); } catch (e) { toast(e.message, true); }
    drawMarket();
  });
  document.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => openOfferModal(view.players.find(p => p.id === b.dataset.buy)));
  document.querySelectorAll('[data-rej]').forEach(b => b.onclick = () => respond(b.dataset.rej, 'reject', 'Proposta recusada'));
  document.querySelectorAll('[data-can]').forEach(b => b.onclick = () => respond(b.dataset.can, 'cancel', 'Proposta cancelada'));
  document.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => {
    const x = o.incoming.find(i => i.id === b.dataset.acc);
    openModal(`<h2>Aceitar proposta?</h2><p>Você <b>vende</b> ${esc(x.want.name)} (${pdesc(x.want)}) e recebe <b>${fmtMoney(x.money)}</b>${x.swap ? ` + <b>${esc(x.swap.name)}</b> (${pdesc(x.swap)})` : ''}.</p>
      <p class="small muted">A troca é imediata e não pode ser desfeita. Se o jogador estiver na sua escalação, um reserva da mesma posição assume o lugar.</p>
      <div class="err" id="ae"></div><div class="row"><button class="btn ghost" id="ac">Voltar</button><button class="btn" id="ao">Confirmar venda</button></div>`);
    $('#ac').onclick = closeModal;
    $('#ao').onclick = async () => {
      try { await api('/market/respond', { method: 'POST', body: { id: x.id, action: 'accept' } }); closeModal(); toast('Transferência concluída ✓'); market(); }
      catch (e) { $('#ae').textContent = e.message; }
    };
  });
}
async function respond(id, action, msg) {
  try { await api('/market/respond', { method: 'POST', body: { id, action } }); toast(msg); market(); }
  catch (e) { toast(e.message, true); market(); }
}
async function openOfferModal(p) {
  const { m, view } = S.mk;
  if (!S.mk.mine) S.mk.mine = (await api('/market/mine')).players;
  const minV = Math.round(p.value * m.limits.minRatio);
  openModal(`<h2>Proposta por ${esc(p.name)}</h2>
    <p class="small muted" style="margin-top:0">${pdesc(p)} · valor de mercado ${fmtMoney(p.value)} · mínimo aceito ${fmtMoney(minV)} · seu caixa ${fmtMoney(m.cash)}</p>
    <label>Dinheiro (R$ milhões)</label><input id="mm" type="number" step="0.1" min="0" value="${Math.min(p.value, Math.max(m.cash, 0)) / 1e6}">
    <label>Incluir um jogador seu na troca (opcional)</label>
    <select id="ms"><option value="">Nenhum</option>${S.mk.mine.map(x => `<option value="${x.id}">${esc(x.name)} · ${pdesc(x)} · ${fmtMoney(x.value)}</option>`).join('')}</select>
    <div class="small" id="mh" style="margin-top:8px"></div><div class="err" id="me"></div>
    <div class="row" style="margin-top:8px"><button class="btn ghost" id="mc2">Cancelar</button><button class="btn" id="mo2">Enviar proposta</button></div>`);
  const calc = () => {
    const money = Math.round((Number($('#mm').value) || 0) * 1e6), sid = $('#ms').value;
    const sw = S.mk.mine.find(x => x.id === sid), total = money + (sw ? sw.value : 0);
    const pct = Math.round(total / p.value * 100);
    $('#mh').innerHTML = `Sua oferta vale <b>${fmtMoney(total)}</b> (${pct}% do valor). ${pct < Math.round(m.limits.minRatio * 100) ? '<span class="bad">Abaixo do mínimo.</span>' : '<span class="good">Dentro do mínimo.</span>'}${money > m.cash ? ' <span class="bad">Dinheiro maior que seu caixa.</span>' : ''}`;
    return { money, sid };
  };
  $('#mm').oninput = calc; $('#ms').onchange = calc; calc();
  $('#mc2').onclick = closeModal;
  $('#mo2').onclick = async () => {
    const { money, sid } = calc();
    try {
      await api('/market/offer', { method: 'POST', body: { to: view.team.id, pid: p.id, money, swapPid: sid || null } });
      closeModal(); toast('Proposta enviada ✓'); market();
    } catch (e) { $('#me').textContent = e.message; }
  };
}

// ----------------------------------------------------------------- tabela ---
async function table() {
  const rows = S.state.table, n = rows.length;
  content().innerHTML = `<div class="card"><div class="row between"><h2>Classificação</h2><span class="badge">Temporada ${S.state.season}</span></div>
    <div class="tablewrap"><table><tr><th>#</th><th class="l">Time</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th><th>SG</th></tr>
    ${rows.map(r => `<tr class="${r.id === myId() ? 'me' : ''} ${r.pos <= 4 ? 'z-lib' : r.pos <= 6 ? 'z-sul' : r.pos > n - 4 ? 'z-rebx' : ''}">
      <td>${r.pos}</td><td class="l teamlink" data-id="${r.id}"><span class="tinline">${teamShield(r.id, 20)}<span>${esc(r.name)}${r.owner ? ' <span class="muted small">· ' + esc(r.owner) + '</span>' : ''}</span></span></td>
      <td class="pts">${r.p}</td><td>${r.j}</td><td>${r.v}</td><td>${r.e}</td><td>${r.d}</td><td>${r.sg}</td></tr>`).join('')}</table></div>
    <p class="small muted">🟩 Libertadores (1º-4º) · 🟦 Sul-Americana (5º-6º) · 🟥 Rebaixamento (4 últimos) — rebaixamento ainda não afeta o jogo.</p></div>`;
  document.querySelectorAll('.teamlink').forEach(el => el.onclick = () => openTeam(el.dataset.id));
  await scorers();
}

// ----------------------------------------------------------------- rodadas --
async function rounds() {
  const st = S.state;
  if (S.round == null) S.round = (st.lastRound ? st.lastRound.round : (st.nextRound ? st.nextRound.round : 1));
  const f = await api('/round/' + S.round);
  content().innerHTML = `<div class="card">
    <div class="rnav"><button id="pv">‹</button><div style="text-align:center"><h2 style="margin:0">Rodada ${f.round}</h2><div class="small muted">${fmtKick(f.kickoff)}</div></div><button id="nx">›</button></div>
    ${f.matches.map((m, i) => `<div class="match ${m.h === myId() || m.a === myId() ? 'mine' : ''}" data-i="${i}">
      <div class="line"><div class="h"><span class="tinline end"><span>${esc(m.hn)}</span>${teamShield(m.h, 20)}</span></div><div class="sc">${m.done ? m.hg + ' x ' + m.ag : 'x'}</div><div class="a"><span class="tinline">${teamShield(m.a, 20)}<span>${esc(m.an)}</span></span></div></div>
      <div class="goals">${m.done ? (() => { const ev = matchEvents(m); return (ev.length ? ev.map(e => `<div>${e.html}</div>`).join('') : '<div>Sem gols ou ocorrências</div>') + `<div>Formações: ${esc(m.hf)} × ${esc(m.af)} · Força ${m.hStr} × ${m.aStr}</div>`; })() : '<div>Ainda não jogado</div>'}</div>
    </div>`).join('')}</div>`;
  $('#pv').onclick = () => { if (S.round > 1) { S.round--; rounds(); } };
  $('#nx').onclick = () => { if (S.round < st.totalRounds) { S.round++; rounds(); } };
  document.querySelectorAll('.match').forEach(el => el.onclick = () => el.classList.toggle('open'));
}

// --------------------------------------------------------------- artilharia -
async function scorers() {
  const { scorers } = await api('/scorers');
  content().insertAdjacentHTML('beforeend', `<div class="card"><h2>Artilharia</h2>${scorers.length ? `<table><tr><th>#</th><th class="l">Jogador</th><th class="l">Time</th><th>Gols</th></tr>
    ${scorers.map((s, i) => `<tr><td>${i + 1}</td><td class="l">${esc(s.name)}</td><td class="l">${esc(s.teamName)}</td><td class="pts">${s.goals}</td></tr>`).join('')}</table>` : '<p class="muted">Nenhum gol ainda. Aguarde a primeira rodada!</p>'}</div>`);
}

// -------------------------------------------------------------------- boot --
async function boot() {
  try {
    if (!S.token) return viewAuth();
    S.me = await api('/me');
    if (!S.teams) { const t = await api('/teams'); S.teams = t.teams; t.teams.forEach(x => { TEAM_COLORS[x.id] = x; }); }
    if (!S.me.teamId) { await viewPickTeam(); $('#lo').onclick = () => logout(); return; }
    await viewMain();
  } catch (e) { if (S.token) toast(e.message, true); else viewAuth(); }
}
setInterval(async () => { // atualiza dados em segundo plano
  if (!S.token || !S.me?.teamId || document.hidden || !['home', 'table'].includes(S.tab)) return;
  try { await refreshState(); S.tab === 'home' ? home() : table(); } catch {}
}, 60000);
boot();
