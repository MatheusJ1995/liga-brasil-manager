'use strict';
// Testes das regras do jogo. Rode com:  node test.js
const assert = require('assert');
const G = require('./game');

let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('  ✓', name); };

const world = G.createWorld();

t('20 times, 22 jogadores cada', () => {
  assert.strictEqual(Object.keys(world.teams).length, 20);
  for (const team of Object.values(world.teams)) assert.strictEqual(team.players.length, 22);
});

t('calendário: 38 rodadas, 10 jogos cada, só quartas e domingos', () => {
  assert.strictEqual(world.fixtures.length, 38);
  let prev = 0;
  for (const f of world.fixtures) {
    assert.strictEqual(f.matches.length, 10);
    assert.ok(f.kickoff > prev, 'horários crescentes');
    prev = f.kickoff;
    const dow = new Date(f.kickoff - 3 * 3600e3).getUTCDay();
    assert.ok(dow === 0 || dow === 3, 'dia da semana ' + dow);
    const local = new Date(f.kickoff - 3 * 3600e3);
    const hm = local.getUTCHours() * 60 + local.getUTCMinutes();
    assert.strictEqual(hm, dow === 3 ? 21 * 60 + 30 : 16 * 60);
  }
});

t('cada time joga todas as rodadas e enfrenta todos 2x (1 casa, 1 fora)', () => {
  const pairs = {};
  for (const f of world.fixtures) {
    const seen = new Set();
    for (const m of f.matches) {
      assert.ok(!seen.has(m.h) && !seen.has(m.a), 'time repetido na rodada ' + f.round);
      seen.add(m.h); seen.add(m.a);
      pairs[m.h + '>' + m.a] = (pairs[m.h + '>' + m.a] || 0) + 1;
    }
    assert.strictEqual(seen.size, 20);
  }
  assert.strictEqual(Object.keys(pairs).length, 380);
  assert.ok(Object.values(pairs).every(v => v === 1));
});

t('mando de campo alterna: no máx. 3 jogos seguidos em casa/fora, 19 em casa por time', () => {
  for (let k = 0; k < 50; k++) {
    const w = G.createWorld();
    for (const id of Object.keys(w.teams)) {
      let run = 0, prev = null, max = 0, home = 0;
      for (const f of w.fixtures) {
        const m = f.matches.find(x => x.h === id || x.a === id);
        const h = m.h === id; if (h) home++;
        if (h === prev) run++; else { run = 1; prev = h; }
        max = Math.max(max, run);
      }
      assert.strictEqual(home, 19);
      assert.ok(max <= 3, 'sequência de ' + max);
    }
  }
});

t('escalação inválida é rejeitada', () => {
  const team = world.teams.fla;
  assert.ok(G.lineupStrength(team, team.players.slice(0, 10).map(p => p.id), '4-4-2').error);
  const noGK = team.players.filter(p => p.pos !== 'GK').slice(0, 11).map(p => p.id);
  assert.ok(G.lineupStrength(team, noGK, '4-4-2').error);
  assert.ok(G.lineupStrength(team, G.bestLineup(team, '4-4-2'), '9-9-9').error);
  const dup = G.bestLineup(team, '4-4-2'); dup[1] = dup[0];
  assert.ok(G.lineupStrength(team, dup, '4-4-2').error);
});

t('jogador fora de posição reduz a força', () => {
  const team = world.teams.pal;
  const good = G.lineupStrength(team, G.bestLineup(team, '4-4-2'), '4-4-2');
  const lu = G.bestLineup(team, '4-4-2');
  const gk = team.players.find(p => lu.includes(p.id) && p.pos === 'GK').id;
  const atts = team.players.filter(p => p.pos === 'ATT').map(p => p.id);
  const defs = team.players.filter(p => p.pos === 'DEF').slice(0, 5).map(p => p.id);
  // 1 GK + 5 ATT + 5 DEF em 4-4-2  => meio-campo vazio, sobra gente improvisada
  const weird = [gk, ...atts, ...defs];
  const w = G.lineupStrength(team, weird, '4-4-2');
  assert.ok(!w.error, w.error);
  assert.ok(w.slots.some(s => s.penalty < 1));
  assert.ok(w.overall < good.overall);
});

t('simulação: time forte ganha mais que time fraco (3000 jogos)', () => {
  const strong = world.teams.fla, weak = world.teams.spo;
  let sw = 0, ww = 0, d = 0, goals = 0;
  const rng = Math.random;
  for (let i = 0; i < 3000; i++) {
    const home = i % 2 ? strong : weak, away = i % 2 ? weak : strong;
    const r = G.simulateMatch(JSON.parse(JSON.stringify(home)), JSON.parse(JSON.stringify(away)), rng);
    goals += r.hg + r.ag;
    const sg = i % 2 ? r.hg : r.ag, wg = i % 2 ? r.ag : r.hg;
    if (sg > wg) sw++; else if (sg < wg) ww++; else d++;
  }
  const avg = goals / 3000;
  console.log(`      forte ${sw} | empates ${d} | fraco ${ww} | média gols/jogo ${avg.toFixed(2)}`);
  assert.ok(sw > ww * 1.5, 'forte deve vencer bem mais');
  assert.ok(avg > 1.8 && avg < 3.6, 'média de gols realista');
});

t('temporada completa: tabela consistente, campeão registrado, nova temporada', () => {
  for (let i = 0; i < 38; i++) {
    const f = G.nextFixture(world);
    assert.strictEqual(f.round, i + 1);
    if (i === 37) {
      const table = G.computeTable(world);
      assert.ok(table.every(r => r.j === 37));
    }
    G.playRound(world, f);
  }
  assert.strictEqual(world.season, 2);
  assert.strictEqual(world.history.length, 1);
  assert.strictEqual(world.fixtures.length, 38);
  assert.ok(world.fixtures.every(f => !f.done));
  assert.ok(G.topScorers(world).length === 0, 'artilharia zerada');
  const table = G.computeTable(world);
  assert.ok(table.every(r => r.j === 0));
});

t('slotsAfter: respeita fuso de Brasília', () => {
  // segunda 2026-11-23 10:36 BRT -> próxima é quarta 25/11 21:30 BRT = 26/11 00:30 UTC
  const ts = Date.UTC(2026, 10, 23, 13, 36);
  const s = G.slotsAfter(ts, 3);
  assert.strictEqual(new Date(s[0]).toISOString(), '2026-11-26T00:30:00.000Z');
  assert.strictEqual(new Date(s[1]).toISOString(), '2026-11-29T19:00:00.000Z');
  assert.strictEqual(new Date(s[2]).toISOString(), '2026-12-03T00:30:00.000Z');
});


// ------------------------------------------------------------- finanças ----
const fw = G.createWorld();
const cash0 = Object.fromEntries(Object.values(fw.teams).map(x => [x.id, x.cash]));
for (let i = 0; i < 38; i++) { fw._r = i; G.playRound(fw, G.nextFixture(fw)); }

t('finanças: caixa = inicial + soma dos saldos; saldo = bilheteria + patrocínio - salários', () => {
  for (const team of Object.values(fw.teams)) {
    const log = team.fin.slice(-38);
    assert.strictEqual(log.length, 38);
    let net = 0;
    for (const e of log) {
      assert.strictEqual(e.net, e.gate + e.sponsor - e.wages);
      net += e.net;
    }
    assert.strictEqual(team.cash, cash0[team.id] + net);
  }
});

t('finanças: bilheteria só para o mandante (19 jogos em casa por time) e público <= capacidade', () => {
  for (const team of Object.values(fw.teams)) {
    const log = team.fin.slice(-38);
    const home = log.filter(e => e.home);
    assert.strictEqual(home.length, 19);
    for (const e of log) {
      if (!e.home) assert.ok(e.gate === 0 && e.att === 0);
      else { assert.ok(e.att <= G.capacityOf(team)); assert.strictEqual(e.gate, e.att * e.price); }
    }
  }
});

t('finanças: preço tem ponto ideal (nem muito baixo, nem muito alto)', () => {
  for (const id of ['fla', 'cor', 'spo']) {
    const team = fw.teams[id], ref = G.prefPrice(team);
    const gate = p => G.estimateAttendance(team, p) * p;
    assert.ok(gate(Math.round(ref * 1.3)) > gate(ref), id + ': subir um pouco deve render mais');
    assert.ok(gate(Math.round(ref * 1.3)) > gate(Math.round(ref * 3)), id + ': preço absurdo rende menos');
    assert.ok(gate(Math.round(ref * 1.3)) > gate(Math.round(ref * 0.4)), id + ': preço muito baixo rende menos');
    // público nunca cresce quando o preço sobe
    let prev = Infinity;
    for (let p = G.MIN_PRICE; p <= G.MAX_PRICE; p += 5) { const a = G.estimateAttendance(team, p); assert.ok(a <= prev); prev = a; }
  }
});

t('finanças: com preço padrão nenhum clube quebra nem enriquece demais em 1 temporada', () => {
  for (const team of Object.values(fw.teams)) {
    const net = team.fin.slice(-38).reduce((a, e) => a + e.net, 0);
    assert.ok(net > -20e6 && net < 25e6, team.short + ' saldo ' + (net / 1e6).toFixed(1) + ' mi');
  }
});

t('finanças: migração de estado antigo (sem caixa) funciona', () => {
  const old = G.createWorld();
  for (const x of Object.values(old.teams)) { delete x.cash; delete x.ticketPrice; delete x.form; delete x.fin; }
  G.ensureFinance(old);
  for (const x of Object.values(old.teams)) { assert.ok(x.cash > 0 && x.ticketPrice >= G.MIN_PRICE && Array.isArray(x.fin)); }
  G.playRound(old, G.nextFixture(old)); // não pode quebrar
});


// -------------------------------------------------------------- mercado ----
function mkMarket() {
  const w = G.createWorld();
  w.teams.fla.ownerId = 'u1'; w.teams.pal.ownerId = 'u2';
  for (const id of ['fla', 'pal']) { const x = w.teams[id]; x.lineup = G.bestLineup(x, x.formation); }
  return w;
}
const offer = (w, o) => ({ id: 'o1', status: 'pending', from: 'fla', to: 'pal', money: 5e6, swapPid: null, ...o });

t('mercado: valor sobe com a força, cai com a idade', () => {
  const v = (ovr, age) => G.playerValue({ ovr, age });
  assert.ok(v(80, 26) > v(70, 26) && v(70, 26) > v(60, 26));
  assert.ok(v(80, 22) > v(80, 26) && v(80, 26) > v(80, 30) && v(80, 30) > v(80, 34));
  assert.ok(v(30, 26) >= 100000);
});

t('mercado: janela só abre nas rodadas 1-5 e 19-24 e fecha 1h antes do jogo', () => {
  const w = mkMarket();
  const f1 = G.nextFixture(w);
  assert.strictEqual(G.marketStatus(w, f1.kickoff - 3 * 3600e3).open, true);
  const lock = G.marketStatus(w, f1.kickoff - 30 * 60e3);
  assert.ok(!lock.open && lock.reason === 'lock');
  const rounds = [];
  for (let i = 0; i < 37; i++) {
    const f = G.nextFixture(w);
    const open = G.marketStatus(w, f.kickoff - 5 * 3600e3).open;
    rounds.push([f.round, open]);
    G.playRound(w, f);
  }
  for (const [r, open] of rounds) assert.strictEqual(open, (r >= 1 && r <= 5) || (r >= 19 && r <= 24), 'rodada ' + r);
  assert.strictEqual(G.marketStatus(w, 0).reason, 'window');
});

t('mercado: validações (ban, caixa, valor mínimo, só entre treinadores, elenco)', () => {
  const w = mkMarket(); const ts = G.nextFixture(w).kickoff - 5 * 3600e3;
  const pal = w.teams.pal, fla = w.teams.fla;
  fla.cash = 500e6;
  const star = pal.players.filter(p => p.pos === 'ATT')[0];
  assert.strictEqual(G.validateOffer(w, offer(w, { pid: star.id, money: G.playerValue(star) }), ts), null);
  assert.match(G.validateOffer(w, offer(w, { pid: star.id, money: 1000 }), ts), /50%/);
  assert.match(G.validateOffer(w, offer(w, { pid: star.id, money: fla.cash + 1 }), ts), /caixa/);
  assert.match(G.validateOffer(w, offer(w, { pid: star.id, money: 0 }), ts), /dinheiro/);
  assert.match(G.validateOffer(w, offer(w, { pid: 'nao-existe' }), ts), /não está mais/);
  assert.match(G.validateOffer(w, offer(w, { pid: star.id, money: 1.5 }), ts), /inválido/);
  w.teams.cor.ownerId = null;
  assert.match(G.validateOffer(w, offer(w, { to: 'cor', pid: w.teams.cor.players[0].id }), ts), /entre treinadores/);
  // ban: contratante com caixa negativo
  fla.cash = -1;
  assert.match(G.validateOffer(w, offer(w, { pid: star.id, money: 0, swapPid: fla.players[0].id }), ts), /ban/i);
  fla.cash = 500e6;
  // fora da janela / travado
  assert.match(G.validateOffer(w, offer(w, { pid: star.id }), G.nextFixture(w).kickoff - 60e3), /1h/);
  // limite de elenco: PAL só tem 3 goleiros, vender 2 deixa menos que o mínimo
  const [g1, g2] = pal.players.filter(p => p.pos === 'GK');
  G.applyTransfer(w, offer(w, { pid: g1.id, money: G.playerValue(g1) }));
  assert.match(G.validateOffer(w, offer(w, { id: 'o2', pid: g2.id, money: G.playerValue(g2) }), ts), /goleiros/);
});

t('mercado: transfer ban impede contratar, mas permite vender; troca com clube banido é barrada', () => {
  const w = mkMarket(); const ts = G.nextFixture(w).kickoff - 5 * 3600e3;
  const fla = w.teams.fla, pal = w.teams.pal;
  fla.cash = 500e6; pal.cash = -2e6;                 // PAL em ban
  const flaPlayer = fla.players.filter(p => p.pos === 'MID')[0];
  const palMid = pal.players.filter(p => p.pos === 'MID')[0];
  assert.strictEqual(G.validateOffer(w, offer(w, { pid: palMid.id, money: G.playerValue(palMid) }), ts), null); // vender: ok
  assert.match(G.validateOffer(w, offer(w, { from: 'pal', to: 'fla', pid: flaPlayer.id, money: 0, swapPid: pal.players[0].id }), ts), /ban/i); // comprar: não
  // FLA tenta trocar jogador com PAL banido (PAL receberia jogador): barrado
  assert.match(G.validateOffer(w, offer(w, { pid: pal.players.filter(p => p.pos === 'MID')[0].id, money: 1e6, swapPid: flaPlayer.id }), ts), /transfer ban/);
});

t('mercado: executar troca move jogador, dinheiro, folha e conserta escalação', () => {
  const w = mkMarket(); const ts = G.nextFixture(w).kickoff - 5 * 3600e3;
  const fla = w.teams.fla, pal = w.teams.pal;
  const want = pal.players.filter(p => pal.lineup.includes(p.id) && p.pos === 'DEF')[0];   // titular do PAL
  const give = fla.players.filter(p => fla.lineup.includes(p.id) && p.pos === 'DEF')[0];   // titular do FLA
  fla.cash = 500e6;
  const money = Math.max(1e6, G.playerValue(want) - G.playerValue(give));
  const o = offer(w, { pid: want.id, money, swapPid: give.id });
  w.offers.push(o);
  assert.strictEqual(G.validateOffer(w, o, ts), null);
  const c = [fla.cash, pal.cash], pr = [G.payroll(fla), G.payroll(pal)], sizes = [fla.players.length, pal.players.length];
  G.applyTransfer(w, o);
  assert.ok(fla.players.includes(want) && !pal.players.includes(want));
  assert.ok(pal.players.includes(give) && !fla.players.includes(give));
  assert.strictEqual(fla.cash, c[0] - money); assert.strictEqual(pal.cash, c[1] + money);
  assert.strictEqual(fla.players.length, sizes[0]); assert.strictEqual(pal.players.length, sizes[1]);
  assert.strictEqual(G.payroll(fla) - pr[0], G.wageOf(want.ovr) - G.wageOf(give.ovr));
  for (const x of [fla, pal]) {
    assert.ok(!G.lineupStrength(x, x.lineup, x.formation).error, 'escalação de ' + x.short + ' inválida');
    assert.ok(x.lineup.every(id => x.players.some(p => p.id === id)));
  }
  assert.ok(!fla.lineup.includes(give.id) && !pal.lineup.includes(want.id));
  assert.strictEqual(w.transfers.length, 1);
  assert.strictEqual(w.transfers[0].player.id, want.id);
});

t('mercado: outras propostas com o mesmo jogador expiram após a troca', () => {
  const w = mkMarket(); w.teams.cor.ownerId = 'u3';
  const star = w.teams.pal.players.filter(p => p.pos === 'ATT')[0];
  const a = offer(w, { id: 'a', pid: star.id, money: 8e6 });
  const b = offer(w, { id: 'b', from: 'cor', pid: star.id, money: 9e6 });
  w.offers.push(a, b);
  G.applyTransfer(w, a);
  assert.strictEqual(b.status, 'expired');
});


// --------------------------------------------------- cartões e lesões ------
t('cartões e lesões: jogador suspenso/lesionado é barrado na escalação e substituído no jogo', () => {
  const w = G.createWorld();
  const fla = w.teams.fla;
  fla.ownerId = 'u1';
  fla.lineup = G.bestLineup(fla, '4-4-2');
  const p0 = fla.players.find(p => p.id === fla.lineup[0]);
  p0.suspended = 1;
  assert.match(G.lineupStrength(fla, fla.lineup, '4-4-2').error, /suspenso/);
  assert.ok(!G.bestLineup(fla, '4-4-2').includes(p0.id));
  const matchLu = G.lineupForMatch(fla);
  assert.ok(!matchLu.strength.error);
  assert.ok(!matchLu.lineup.includes(p0.id));

  p0.suspended = 0; p0.injured = 2; p0.injuryName = 'Entorse';
  assert.match(G.lineupStrength(fla, fla.lineup, '4-4-2').error, /lesionado/);
  assert.ok(!G.lineupForMatch(fla).lineup.includes(p0.id));
});

t('cartões e lesões: cumprimento de suspensão e recuperação entre rodadas', () => {
  const w = G.createWorld();
  const fla = w.teams.fla;
  const pSusp = fla.players[0], pInj = fla.players[1];
  pSusp.suspended = 1;
  pInj.injured = 2; pInj.injuryName = 'Estiramento muscular';

  // Rodada 1: nenhum dos dois pode jogar; após a rodada, pSusp volta (0) e pInj cai para 1
  const f1 = G.nextFixture(w);
  G.playRound(w, f1);
  const m1 = f1.matches.find(m => m.h === 'fla' || m.a === 'fla');
  assert.ok(!m1.goals.some(g => g.pid === pSusp.id || g.pid === pInj.id));
  assert.ok(!m1.cards.some(c => c.pid === pSusp.id || c.pid === pInj.id));
  assert.ok(!m1.injuries.some(j => j.pid === pSusp.id || j.pid === pInj.id));
  assert.strictEqual(pSusp.suspended, 0);
  assert.strictEqual(pInj.injured, 1);
  assert.strictEqual(pInj.injuryName, 'Estiramento muscular');

  // Rodada 2: pInj cumpre a última rodada e zera injuryName
  G.playRound(w, G.nextFixture(w));
  assert.strictEqual(pInj.injured, 0);
  assert.strictEqual(pInj.injuryName, null);
});

t('cartões e lesões: 3º amarelo suspende, acumula estatísticas e reseta no fim da temporada', () => {
  const w = G.createWorld();
  let totalCards = 0, totalInjuries = 0, thirdYellowSusp = 0;
  for (let i = 0; i < 38; i++) {
    const f = G.nextFixture(w);
    G.playRound(w, f);
    for (const m of f.matches) {
      assert.ok(Array.isArray(m.cards) && Array.isArray(m.injuries));
      totalCards += m.cards.length;
      totalInjuries += m.injuries.length;
      thirdYellowSusp += m.cards.filter(c => c.susp).length;
    }
  }
  assert.ok(totalCards > 300, 'cartões na temporada: ' + totalCards);
  assert.ok(totalInjuries > 50, 'lesões na temporada: ' + totalInjuries);
  assert.ok(thirdYellowSusp > 10, 'suspensões por 3º amarelo: ' + thirdYellowSusp);
  assert.strictEqual(w.season, 2);
  for (const team of Object.values(w.teams)) {
    for (const p of team.players) {
      assert.strictEqual(p.yellows, 0);
      assert.strictEqual(p.totalYellows, 0);
      assert.strictEqual(p.totalReds, 0);
      assert.strictEqual(p.suspended, 0);
      assert.strictEqual(p.injured, 0);
      assert.strictEqual(p.injuryName, null);
    }
  }
});

t('cartões e lesões: migração de estado antigo e fallback sem goleiros disponíveis', () => {
  const w = G.createWorld();
  for (const team of Object.values(w.teams)) {
    for (const p of team.players) {
      delete p.yellows; delete p.totalYellows; delete p.totalReds;
      delete p.suspended; delete p.injured; delete p.injuryName;
    }
  }
  G.ensurePlayers(w);
  for (const p of w.teams.fla.players) assert.strictEqual(p.yellows, 0);

  // Todos os 3 goleiros indisponíveis: ainda gera escalação válida de emergência
  for (const gk of w.teams.fla.players.filter(p => p.pos === 'GK')) gk.injured = 1;
  const lu = G.lineupForMatch(w.teams.fla);
  assert.strictEqual(lu.lineup.length, 11);
  assert.ok(!lu.strength.error, lu.strength.error);
});

t('cpf: valida dígitos verificadores, formatação e rejeita sequências repetidas', () => {
  assert.strictEqual(G.cleanCpf('529.982.247-25'), '52998224725');
  assert.strictEqual(G.isValidCpf('52998224725'), true);
  assert.strictEqual(G.isValidCpf('529.982.247-25'), true);
  assert.strictEqual(G.isValidCpf('11144477735'), true);
  assert.strictEqual(G.isValidCpf('52998224726'), false);
  assert.strictEqual(G.isValidCpf('52998224715'), false);
  assert.strictEqual(G.isValidCpf('11111111111'), false);
  assert.strictEqual(G.isValidCpf('00000000000'), false);
  assert.strictEqual(G.isValidCpf('1234567890'), false);
  assert.strictEqual(G.isValidCpf(''), false);
});

t('elencos reais: 20 times com 3 GK, 7 DEF, 7 MID, 5 ATT e nomes reais', () => {
  const w = G.createWorld();
  for (const team of Object.values(w.teams)) {
    assert.strictEqual(team.players.length, 22, team.id);
    assert.strictEqual(team.players.filter(p => p.pos === 'GK').length, 3, team.id + ' GK');
    assert.strictEqual(team.players.filter(p => p.pos === 'DEF').length, 7, team.id + ' DEF');
    assert.strictEqual(team.players.filter(p => p.pos === 'MID').length, 7, team.id + ' MID');
    assert.strictEqual(team.players.filter(p => p.pos === 'ATT').length, 5, team.id + ' ATT');
    assert.strictEqual(new Set(team.players.map(p => p.id)).size, 22, team.id + ' ids');
  }
  assert.ok(w.teams.fla.players.some(p => p.name === 'Arrascaeta'));
  assert.ok(w.teams.pal.players.some(p => p.name === 'Vitor Roque'));
  assert.ok(w.teams.san.players.some(p => p.name === 'Neymar Jr'));
});

console.log(`\n${ok} testes passaram`);
