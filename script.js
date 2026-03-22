"use strict";

// ═══════════════════════════════════════════════
//  STORAGE
// ═══════════════════════════════════════════════
const K = { pl: 'ssx4_players', lv: 'ssx4_levels', lb: 'ssx4_lb', cu: 'ssx4_cur', pr: 'ssx4_progress' };
const hasWS = typeof window !== 'undefined' && window.storage && typeof window.storage.get === 'function' && typeof window.storage.set === 'function';
const dbGet = async k => {
  try {
    if (hasWS) {
      const r = await window.storage.get(k);
      return r ? JSON.parse(r.value) : null;
    }
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
};
const dbSet = async (k, v) => {
  try {
    const json = JSON.stringify(v);
    if (hasWS) await window.storage.set(k, json);
    try { localStorage.setItem(k, json); } catch (e) { }
  } catch (e) { }
};
async function savePlayer(nm, d) { let p = await dbGet(K.pl) || {}; p[nm] = { ...(p[nm] || {}), ...d, name: nm, lastPlayed: new Date().toISOString() }; await dbSet(K.pl, p); await dbSet(K.cu, nm); }
async function loadPlayer(nm) { const p = await dbGet(K.pl) || {}; const r = p[nm]; if (!r) return null; return { ...basePlayer(), ...r, shopInv: mergeShopInv(r.shopInv) }; }
async function getAllPlayers() { const p = await dbGet(K.pl) || {}; return Object.values(p).sort((a, b) => (b.highScore || 0) - (a.highScore || 0)); }
async function saveLevelResult(nm, lv, res) {
  let d = await dbGet(K.lv) || {};
  if (!d[nm]) d[nm] = { completed: [], scores: {}, unlocked: [1] };
  if (!d[nm].completed.includes(lv)) d[nm].completed.push(lv);
  if (!d[nm].scores[lv] || res.score > d[nm].scores[lv].score) d[nm].scores[lv] = res;
  d[nm].maxLevel = Math.max(d[nm].maxLevel || 0, lv);
  const unlockedTo = Math.min((d[nm].maxLevel || 0) + 1, MAX_LEVELS);
  d[nm].unlocked = Array.from({ length: unlockedTo }, (_, i) => i + 1);
  await dbSet(K.lv, d);
}
async function loadLevelData(nm) {
  const d = await dbGet(K.lv) || {};
  const r = d[nm] || { completed: [], scores: {}, maxLevel: 0, unlocked: [1] };
  if (r.completed && r.completed.length > 0) r.maxLevel = Math.max(r.maxLevel || 0, ...r.completed);
  const unlockedTo = Math.max(1, Math.min((r.maxLevel || 0) + 1, MAX_LEVELS));
  r.unlocked = Array.from({ length: unlockedTo }, (_, i) => i + 1);
  return r;
}
async function saveProgress(nm, p) {
  let d = await dbGet(K.pr) || {};
  d[nm] = { ...(d[nm] || {}), ...p, updatedAt: new Date().toISOString() };
  await dbSet(K.pr, d);
}
async function loadProgress(nm) {
  const d = await dbGet(K.pr) || {};
  return d[nm] || { curLv: 1, totalSc: 0, selChar: 0, lastLevelPlayed: 1 };
}
const getLB = async () => await dbGet(K.lb) || [];
const DEF_SHOP_INV = { extraSp: 0, extraHeal: 0, dmgBoost: 0, rageAmp: 0, comboElixir: 0 };
function mergeShopInv(inv) { return { ...DEF_SHOP_INV, ...inv }; }
function basePlayer() { return { charId: 0, maxLevel: 0, highScore: 0, totalWins: 0, totalScore: 0, coins: 0, bankPts: 0, lastDailyClaim: '', shopInv: mergeShopInv({}) }; }
const SHOP_ITEMS = [
  { id: 'sp', name: 'Extra Special', ico: '💥', desc: '+1 Special use on your next fight (stacks).', pts: 175, coins: 0, inc: { extraSp: 1 } },
  { id: 'heal', name: 'Heal Capsule', ico: '💊', desc: '+1 Heal use on your next fight (stacks).', pts: 120, coins: 14, inc: { extraHeal: 1 } },
  { id: 'pwr', name: 'Power Amp', ico: '⚡', desc: '+12% damage for your next fight.', pts: 195, coins: 16, inc: { dmgBoost: 1 } },
  { id: 'rage', name: 'Rage Elixir', ico: '🔥', desc: 'Faster rage build next fight.', pts: 85, coins: 26, inc: { rageAmp: 1 } },
  { id: 'combo', name: 'Combo Serum', ico: '🔗', desc: 'Stronger combo damage bonus next fight.', pts: 245, coins: 20, inc: { comboElixir: 1 } },
  { id: 'pack', name: 'Brawler Pack', ico: '📦', desc: '+1 Special and +1 Heal for next fight.', pts: 285, coins: 38, inc: { extraSp: 1, extraHeal: 1 } },
  { id: 'coin_heal', name: 'Field Med-Kit', ico: '⛑️', desc: '+1 Heal next fight (coins only).', pts: 0, coins: 42, inc: { extraHeal: 1 } },
];
async function rebuildLeaderboard() {
  const players = await getAllPlayers();
  const lb = players.slice(0, 12).map(p => {
    const ch = CHARS[p.charId || 0];
    let date = '';
    try { if (p.lastPlayed) date = new Date(p.lastPlayed).toLocaleDateString(); } catch (e) { }
    return { name: p.name, char: ch?.name || 'FIGHTER', score: p.highScore || 0, lv: p.maxLevel || 0, coins: p.coins || 0, wins: p.totalWins || 0, bankPts: p.bankPts || 0, date };
  });
  await dbSet(K.lb, lb);
}


// ═══════════════════════════════════════════════
//  AUDIO ENGINE — BGM + Rich SFX
// ═══════════════════════════════════════════════
let AC = null;
const gac = () => { if (!AC) try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } return AC; };
function mkOsc(f, t, st, d, v, a, detune = 0) { try { const o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.type = t; o.frequency.setValueAtTime(f, st); if (detune) o.detune.value = detune; g.gain.setValueAtTime(v, st); g.gain.exponentialRampToValueAtTime(.0001, st + d); o.start(st); o.stop(st + d); } catch (e) { } }
function mkNoise(st, d, v, hp, a, lp = 20000) { try { const sr = a.sampleRate, buf = a.createBuffer(1, Math.floor(sr * d), sr), dt = buf.getChannelData(0); for (let i = 0; i < dt.length; i++)dt[i] = Math.random() * 2 - 1; const src = a.createBufferSource(); src.buffer = buf; const hpf = a.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = hp; const lpf = a.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = lp; const g = a.createGain(); g.gain.setValueAtTime(v, st); g.gain.exponentialRampToValueAtTime(.0001, st + d); src.connect(hpf); hpf.connect(lpf); lpf.connect(g); g.connect(a.destination); src.start(st); src.stop(st + d); } catch (e) { } }

// SFX
function sfxPunch() { const a = gac(); if (!a) return; const t = a.currentTime; mkNoise(t, .06, .72, 1600, a, 7500); mkNoise(t + .01, .08, .42, 600, a, 3200); mkOsc(72, 'triangle', t, .11, .48, a); mkOsc(145, 'sawtooth', t, .06, .2, a); mkOsc(920, 'square', t + .01, .03, .06, a); }
function sfxKick() { const a = gac(); if (!a) return; const t = a.currentTime; mkNoise(t, .09, .76, 820, a, 6000); mkNoise(t + .02, .13, .46, 260, a, 2300); mkOsc(50, 'sine', t, .17, .56, a); mkOsc(100, 'triangle', t, .1, .26, a); mkOsc(210, 'square', t, .05, .13, a); mkOsc(430, 'sawtooth', t + .015, .045, .08, a); }
function sfxSpecial() { const a = gac(); if (!a) return; const t = a.currentTime; mkNoise(t, .22, .42, 400, a, 4000);[160, 240, 320, 480, 640, 800].forEach((f, i) => mkOsc(f, 'sawtooth', t + i * .022, .3 - i * .02, .22, a)); mkOsc(55, 'sine', t, .28, .52, a); mkOsc(880, 'sine', t + .1, .38, .18, a); mkNoise(t + .15, .1, .25, 2000, a); }
function sfxCrit() { const a = gac(); if (!a) return; const t = a.currentTime; mkNoise(t, .2, .95, 300, a, 5000); mkNoise(t + .04, .28, .55, 100, a, 3000); mkOsc(40, 'sine', t, .22, .62, a); mkOsc(80, 'sine', t, .16, .42, a); mkOsc(1100, 'sine', t + .04, .16, .2, a); mkNoise(t, .05, .3, 5000, a); }
function sfxHit() { const a = gac(); if (!a) return; const t = a.currentTime; mkNoise(t, .07, .56, 980, a, 4800); mkNoise(t + .01, .05, .2, 2200, a, 9000); mkOsc(84, 'triangle', t, .1, .33, a); mkOsc(168, 'sawtooth', t, .05, .14, a); }
function sfxBlock() { const a = gac(); if (!a) return; const t = a.currentTime; mkNoise(t, .045, .45, 2200, a, 9000); mkOsc(280, 'square', t, .065, .22, a); mkOsc(560, 'sine', t, .05, .13, a); }
function sfxCounter() { const a = gac(); if (!a) return; const t = a.currentTime;[660, 880, 1175].forEach((f, i) => mkOsc(f, 'square', t + i * .03, .11, .12, a)); mkNoise(t, .06, .24, 1800, a, 9000); }
function sfxHeal() { const a = gac(); if (!a) return; const t = a.currentTime;[523, 659, 784, 1047, 1318].forEach((f, i) => { mkOsc(f, 'sine', t + i * .06, .28, .22, a); mkOsc(f * 2, 'sine', t + i * .06, .14, .08, a); }); }
function sfxDodge() { const a = gac(); if (!a) return; const t = a.currentTime; mkNoise(t, .03, .22, 3000, a); mkOsc(800, 'sine', t, .07, .16, a); mkOsc(1200, 'sine', t + .02, .05, .1, a); }
function sfxStep() { const a = gac(); if (!a) return; const t = a.currentTime; mkNoise(t, .04, .2, 800, a, 2000); mkOsc(120, 'sine', t, .05, .15, a); }
function sfxRage() { const a = gac(); if (!a) return; const t = a.currentTime;[55, 110, 220, 440].forEach((f, i) => mkOsc(f, 'sawtooth', t + i * .04, .32, .32, a)); mkNoise(t, .2, .22, 80, a); }
function sfxDeath() { const a = gac(); if (!a) return; const t = a.currentTime;[330, 280, 240, 200, 170, 140, 110].forEach((f, i) => mkOsc(f, 'sawtooth', t + i * .1, .22, .25, a)); mkNoise(t, .6, .18, 60, a, 500); }
function sfxWin() { const a = gac(); if (!a) return; const t = a.currentTime;[523, 659, 784, 1047, 1318, 1568].forEach((f, i) => mkOsc(f, 'sine', t + i * .09, .34, .22, a)); }
function sfxLose() { const a = gac(); if (!a) return; const t = a.currentTime;[440, 370, 310, 260, 220, 180].forEach((f, i) => mkOsc(f, 'sawtooth', t + i * .12, .26, .22, a)); mkNoise(t, .4, .16, 60, a); }
function sfxBoss() { const a = gac(); if (!a) return; const t = a.currentTime; mkOsc(55, 'sawtooth', t, .55, .52, a); mkOsc(55, 'square', t, .55, .3, a); mkNoise(t, .55, .32, 50, a, 500);[220, 185, 155, 130, 110].forEach((f, i) => mkOsc(f, 'sawtooth', t + i * .08, .22, .16, a)); }
function sfxGameClear() { const a = gac(); if (!a) return; const t = a.currentTime;[523, 659, 784, 1047, 1318, 1568, 2093].forEach((f, i) => { mkOsc(f, 'sine', t + i * .07, .5, .26, a); mkOsc(f * 1.5, 'sine', t + i * .07, .3, .1, a); }); mkNoise(t + .3, .35, .2, 700, a); }
function sfxNav() { const a = gac(); if (!a) return; mkOsc(440, 'sine', a.currentTime, .055, .1, a); }
function sfxSel() { const a = gac(); if (!a) return; const t = a.currentTime; mkOsc(523, 'sine', t, .07, .14, a); mkOsc(659, 'sine', t + .04, .07, .12, a); }
function sfxTick() { const a = gac(); if (!a) return; mkOsc(880, 'sine', a.currentTime, .065, .2, a); }
function sfxUnlock() { const a = gac(); if (!a) return; const t = a.currentTime;[440, 550, 660, 880].forEach((f, i) => mkOsc(f, 'sine', t + i * .06, .2, .2, a)); }

function speakAnnouncer(txt) {
  if (typeof window.speechSynthesis !== 'undefined') {
    try {
      const u = new SpeechSynthesisUtterance(txt);
      u.rate = 0.9; u.pitch = 0.65; u.volume = 1.0;
      const v = window.speechSynthesis.getVoices().find(x => x.name.includes('Male') || x.name.includes('Google UK English Male') || x.name.includes('David'));
      if (v) u.voice = v; window.speechSynthesis.speak(u);
    } catch (e) { }
  }
}

// BGM — cinematic synthwave battle loop
let bgmRunning = false, bgmTimer = null, bgmBeat = 0;
function startBGM() {
  if (bgmRunning) return;
  const a = gac(); if (!a) return;
  if (a.state === 'suspended') a.resume().catch(() => { });
  bgmRunning = true;
  // Slower, intense doom-synth style BGM
  const BPM = 90, BEAT = 60 / BPM, STEP = BEAT * 0.25, LOOK = 1.6;
  const KICK = [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0];
  const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
  const HAT = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1];
  const BASS = [41, 0, 41, 0, 41, 0, 41, 0, 49, 0, 0, 49, 0, 49, 41, 0];
  const CHORDS = [[220, 277, 330], [196, 247, 294], [174, 220, 262], [196, 247, 294]];
  const LEAD = [330, 0, 0, 392, 0, 0, 0, 330, 0, 0, 440, 0, 0, 392, 0, 0];
  let t = a.currentTime + 0.08;
  function schedule() {
    if (!bgmRunning) return;
    const now = a.currentTime;
    while (t < now + LOOK) {
      const i = bgmBeat % 16;
      const bar = Math.floor((bgmBeat % 64) / 16);
      if (KICK[i]) {
        mkNoise(t, .08, .27, 25, a, 180);
        mkOsc(52, 'sine', t, .11, .45, a);
      }
      if (SNARE[i]) {
        mkNoise(t, .07, .24, 1200, a, 7000);
        mkOsc(190, 'triangle', t, .06, .12, a);
      }
      if (HAT[i]) {
        mkNoise(t, .02, .06, i % 2 ? 7500 : 9000, a, 12000);
      }
      const bf = BASS[i];
      if (bf) {
        mkOsc(bf, 'sawtooth', t, STEP * .95, .13, a);
        mkOsc(bf * 2, 'sine', t, STEP * .75, .05, a);
      }
      if (i % 4 === 0) {
        CHORDS[bar].forEach((f, ci) => mkOsc(f, 'triangle', t + ci * .01, STEP * 3.6, .045, a));
      }
      const lf = LEAD[i];
      if (lf) {
        mkOsc(lf, 'square', t, STEP * .85, .06, a, 3);
        if (i % 8 === 7) mkOsc(lf * 2, 'sine', t + .06, STEP * .55, .035, a);
      }
      t += STEP; bgmBeat++;
    }
    bgmTimer = setTimeout(schedule, 120);
  }
  schedule();
}
function stopBGM() { bgmRunning = false; if (bgmTimer) { clearTimeout(bgmTimer); bgmTimer = null; } }

// ═══════════════════════════════════════════════
//  AI
// ═══════════════════════════════════════════════
async function aiTaunt(en, sit, ph, eh) { try { const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 60, messages: [{ role: "user", content: `You are ${en}, a fighting game villain. ONE menacing taunt (max 12 words) for: ${sit}. Player HP:${ph}, You:${eh}. ONLY the taunt text.` }] }) }); const d = await r.json(); return d.content?.[0]?.text?.replace(/["""]/g, "'").trim() || null; } catch (e) { return null; } }
async function aiVictory(pn, cn, sc) { try { const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 80, messages: [{ role: "user", content: `${pn} as ${cn} conquered all 100 levels score ${sc}. ONE epic victory proclamation (max 18 words). Only text.` }] }) }); const d = await r.json(); return d.content?.[0]?.text?.trim() || "The darkness yields. A true champion emerges."; } catch (e) { return "The darkness yields. A true champion emerges."; } }
function showTaunt(name, text, color) { if (!text) return; document.getElementById('tnm').textContent = name; document.getElementById('tnm').style.color = color; document.getElementById('ttxt').textContent = `"${text}"`; const b = document.getElementById('taunt-b'); b.classList.add('vis'); clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('vis'), 3500); }

// ═══════════════════════════════════════════════
//  GAME DATA
// ═══════════════════════════════════════════════
const CHARS = [
  { id: 0, name: 'INFERNO', ico: '🔥', tag: 'Born from the flames', desc: 'Fastest combos and critical hits. Burns through every enemy.', hp: 115, c1: '#c83000', c2: '#e06000', c3: '#ff8800', skin: '#d4845a', eye: '#ffee00', hair: '#1a0800', pR: [8, 15], kR: [14, 22], sR: [28, 42], atk: 5, def: 2, spd: 5, abilities: ['Critical Master', 'Blaze Rush', 'Inferno Strike'] },
  { id: 1, name: 'THUNDER', ico: '⚡', tag: 'Power meets precision', desc: 'Perfectly balanced. Reliable damage with solid defense.', hp: 135, c1: '#0d2255', c2: '#1a4499', c3: '#2266dd', skin: '#7ab0e8', eye: '#44ccff', hair: '#000820', pR: [7, 13], kR: [12, 20], sR: [24, 38], atk: 3, def: 3, spd: 4, abilities: ['Thunder Bolt', 'Storm Guard', 'Lightning Combo'] },
  { id: 2, name: 'TITAN', ico: '🌊', tag: 'Immovable. Unstoppable.', desc: 'Highest HP. Absorbs punishment. Special hits like avalanche.', hp: 165, c1: '#1a4422', c2: '#2e7a3a', c3: '#44aa55', skin: '#6aaa7a', eye: '#88ff44', hair: '#041008', pR: [6, 11], kR: [10, 18], sR: [20, 35], atk: 2, def: 5, spd: 2, abilities: ['Iron Skin', 'Tidal Crush', 'Fortress Mode'] },
];
const LEVELS = [
  { n: 1, nm: 'TRAINING DOJO', bg: 'dojo', time: 70, bon: 0, e: { id: 'novice', nm: 'NOVICE', ico: '🥋', hp: 80, sz: 1.0, c1: '#2a3a3a', c2: '#3a5544', c3: '#4a6655', skin: '#8aaa9a', eye: '#88ffcc', hair: '#102020', pR: [5, 10], kR: [8, 14], sR: [14, 22], miss: .20, boss: false, taunts: ['Come at me, rookie!', 'Is that all you got?'] } },
  { n: 2, nm: 'BACK ALLEY', bg: 'alley', time: 68, bon: 12, e: { id: 'brawler', nm: 'BRAWLER', ico: '💪', hp: 95, sz: 1.06, c1: '#3a2a1a', c2: '#5a3a22', c3: '#7a4a2a', skin: '#c4884a', eye: '#ffaa44', hair: '#1a0800', pR: [7, 13], kR: [11, 18], sR: [18, 28], miss: .17, boss: false, taunts: ['Your bones will crack!', 'Pain is coming.'] } },
  { n: 3, nm: 'ROOFTOP CLASH', bg: 'rooftop', time: 66, bon: 14, e: { id: 'jackal', nm: 'JACKAL', ico: '🦊', hp: 108, sz: 1.10, c1: '#2a1a3a', c2: '#4a2a66', c3: '#6a3a88', skin: '#c888cc', eye: '#ff88ff', hair: '#10080a', pR: [9, 16], kR: [13, 21], sR: [22, 33], miss: .15, boss: false, taunts: ['Nowhere to run!', 'Too slow!'] } },
  { n: 4, nm: 'UNDERGROUND PIT', bg: 'pit', time: 64, bon: 16, e: { id: 'crusher', nm: 'CRUSHER', ico: '⚡', hp: 122, sz: 1.15, c1: '#1a2244', c2: '#2244aa', c3: '#3366cc', skin: '#6688cc', eye: '#00aaff', hair: '#080820', pR: [11, 19], kR: [16, 25], sR: [26, 38], miss: .13, boss: false, taunts: ['The pit is my domain!', 'Feel the thunder!'] } },
  { n: 5, nm: 'DARK CARNIVAL', bg: 'carnival', time: 62, bon: 0, e: { id: 'jester', nm: 'MAD JESTER', ico: '🤡', hp: 145, sz: 1.22, c1: '#3a0a0a', c2: '#880022', c3: '#cc0033', skin: '#ffffff', eye: '#ff2266', hair: '#660011', pR: [14, 22], kR: [19, 30], sR: [30, 45], miss: .10, boss: true, taunts: ['HAHAHA! Dance with me!', 'Your suffering is FUNNY!'] } },
  { n: 6, nm: 'BURNING SLUMS', bg: 'slums', time: 60, bon: 20, e: { id: 'arson', nm: 'ARSONIST', ico: '🔥', hp: 155, sz: 1.20, c1: '#441100', c2: '#882200', c3: '#cc3300', skin: '#aa5522', eye: '#ff4400', hair: '#200800', pR: [13, 22], kR: [18, 28], sR: [28, 42], miss: .11, boss: false, taunts: ['Burn with me!', 'Fire consumes everything!'] } },
  { n: 7, nm: 'FROZEN TUNDRA', bg: 'tundra', time: 58, bon: 22, e: { id: 'frost', nm: 'FROSTBITE', ico: '❄️', hp: 168, sz: 1.25, c1: '#0a1a44', c2: '#1133aa', c3: '#2255cc', skin: '#aaccee', eye: '#88ccff', hair: '#040818', pR: [15, 24], kR: [21, 32], sR: [32, 48], miss: .10, boss: false, taunts: ['Your blood will freeze.', 'Ice does not forgive.'] } },
  { n: 8, nm: 'TOXIC SWAMP', bg: 'swamp', time: 56, bon: 24, e: { id: 'venom', nm: 'VENOM', ico: '☠️', hp: 182, sz: 1.30, c1: '#112211', c2: '#224422', c3: '#336633', skin: '#66aa66', eye: '#44ff44', hair: '#040a04', pR: [17, 27], kR: [23, 36], sR: [35, 52], miss: .09, boss: false, taunts: ['The poison is already in you.', 'Every wound festers.'] } },
  { n: 9, nm: 'DRAGON TEMPLE', bg: 'temple', time: 54, bon: 26, e: { id: 'serpent', nm: 'SERPENT', ico: '🐉', hp: 198, sz: 1.35, c1: '#0a2a0a', c2: '#1a5522', c3: '#2a7733', skin: '#55aa66', eye: '#00ff88', hair: '#020a04', pR: [19, 30], kR: [26, 40], sR: [38, 58], miss: .08, boss: false, taunts: ['Ancient power flows through me.', 'Your technique is flawed.'] } },
  { n: 10, nm: 'DEMON GATE', bg: 'demongate', time: 52, bon: 0, e: { id: 'demon', nm: 'DEMON LORD', ico: '👹', hp: 240, sz: 1.50, c1: '#330011', c2: '#660022', c3: '#990033', skin: '#aa2244', eye: '#ff0044', hair: '#110004', pR: [22, 35], kR: [30, 46], sR: [44, 66], miss: .06, boss: true, taunts: ['I AM THE GATE OF HELL!', 'Your soul belongs to me!'] } },
  { n: 11, nm: 'HELLFIRE CANYON', bg: 'hellcanyon', time: 50, bon: 28, e: { id: 'hellion', nm: 'HELLION', ico: '😈', hp: 220, sz: 1.38, c1: '#3a0808', c2: '#7a1111', c3: '#aa1818', skin: '#881122', eye: '#ff3300', hair: '#150202', pR: [21, 33], kR: [28, 44], sR: [42, 63], miss: .07, boss: false, taunts: ['Hell has no fury like mine!', 'Your pain feeds my power.'] } },
  { n: 12, nm: 'BLOOD COLOSSEUM', bg: 'colosseum', time: 48, bon: 30, e: { id: 'warlord', nm: 'WARLORD', ico: '⚔️', hp: 240, sz: 1.42, c1: '#2a0a0a', c2: '#5a1111', c3: '#881818', skin: '#aa6644', eye: '#ff8800', hair: '#100404', pR: [23, 36], kR: [31, 48], sR: [46, 68], miss: .07, boss: false, taunts: ['Ten thousand battles. Never lost.', 'The crowd thirsts for your blood.'] } },
  { n: 13, nm: 'SHADOW FOREST', bg: 'shadowforest', time: 46, bon: 32, e: { id: 'wraith', nm: 'WRAITH', ico: '👻', hp: 255, sz: 1.45, c1: '#080820', c2: '#111144', c3: '#1a1a66', skin: '#8888cc', eye: '#aaaaff', hair: '#020208', pR: [25, 39], kR: [34, 52], sR: [50, 74], miss: .06, boss: false, taunts: ['I exist between life and death.', 'You cannot kill what is dead.'] } },
  { n: 14, nm: 'LAVA FORTRESS', bg: 'lavafort', time: 44, bon: 34, e: { id: 'magma', nm: 'MAGMA TITAN', ico: '🌋', hp: 270, sz: 1.50, c1: '#440a00', c2: '#881800', c3: '#cc2200', skin: '#aa4422', eye: '#ff6600', hair: '#180400', pR: [27, 42], kR: [37, 56], sR: [54, 80], miss: .05, boss: false, taunts: ['I am the mountain itself!', 'Lava always finds a way.'] } },
  { n: 15, nm: 'VOID REALM', bg: 'void', time: 42, bon: 0, e: { id: 'voidb', nm: 'VOID BEAST', ico: '🌑', hp: 310, sz: 1.62, c1: '#060610', c2: '#0a0a2a', c3: '#111144', skin: '#444466', eye: '#ffffff', hair: '#020208', pR: [30, 46], kR: [40, 62], sR: [58, 88], miss: .04, boss: true, taunts: ['I AM THE END OF ALL THINGS.', 'Reality crumbles before me.'] } },
  { n: 16, nm: 'CURSED RUINS', bg: 'ruins', time: 40, bon: 36, e: { id: 'lich', nm: 'LICH KING', ico: '💀', hp: 285, sz: 1.55, c1: '#0a0a22', c2: '#1a1a55', c3: '#2a2a77', skin: '#cccccc', eye: '#00ffcc', hair: '#050510', pR: [29, 44], kR: [38, 60], sR: [56, 84], miss: .04, boss: false, taunts: ['Death is my kingdom.', 'I have slain ten thousand heroes.'] } },
  { n: 17, nm: 'ABYSSAL PIT', bg: 'abyss', time: 38, bon: 38, e: { id: 'abyssal', nm: 'ABYSSAL', ico: '🕳️', hp: 300, sz: 1.58, c1: '#030318', c2: '#060630', c3: '#0a0a44', skin: '#222244', eye: '#ff00aa', hair: '#010106', pR: [31, 47], kR: [42, 65], sR: [60, 90], miss: .04, boss: false, taunts: ['From the abyss I came.', 'Light dies in me.'] } },
  { n: 18, nm: 'STORM PEAK', bg: 'storm', time: 36, bon: 40, e: { id: 'stormg', nm: 'STORM GOD', ico: '⛈️', hp: 315, sz: 1.62, c1: '#0a1a44', c2: '#1a3a88', c3: '#2255aa', skin: '#88aadd', eye: '#ffff00', hair: '#020810', pR: [33, 50], kR: [44, 68], sR: [64, 96], miss: .03, boss: false, taunts: ['I am the divine storm!', 'Lightning obeys my will.'] } },
  { n: 19, nm: 'CHAOS REALM', bg: 'chaos', time: 34, bon: 42, e: { id: 'chaos', nm: 'CHAOS ENTITY', ico: '🌀', hp: 330, sz: 1.66, c1: '#1a001a', c2: '#440044', c3: '#660066', skin: '#aa44aa', eye: '#ff44ff', hair: '#080008', pR: [35, 53], kR: [47, 72], sR: [68, 102], miss: .03, boss: false, taunts: ['ORDER IS AN ILLUSION!', 'Chaos consumes purpose.'] } },
  { n: 20, nm: 'SHADOW THRONE', bg: 'boss', time: 30, bon: 0, e: { id: 'final', nm: 'SHADOW KING', ico: '👑', hp: 420, sz: 2.0, c1: '#100010', c2: '#2a0044', c3: '#440066', skin: '#220033', eye: '#ff00ff', hair: '#060008', pR: [38, 58], kR: [50, 78], sR: [74, 112], miss: .02, boss: true, taunts: ['I AM SHADOW INCARNATE.', 'You dare face me? FOOL!', 'Your journey ends in eternal darkness.'] } },
];
const MAX_LEVELS = 100;
const BOSS_EVERY = 5;
const EXTRA_NAMES = ['CRIMSON NEXUS', 'IRON DISTRICT', 'NIGHT SPIRE', 'FALLEN SANCTUM', 'WAR DOCKS', 'NEON HARBOR', 'BLADE COURTYARD', 'OBSIDIAN HALL', 'ECLIPSE PASS', 'WRAITH CITADEL'];
const BG_POOL = ['dojo', 'alley', 'rooftop', 'pit', 'carnival', 'slums', 'tundra', 'swamp', 'temple', 'demongate', 'hellcanyon', 'colosseum', 'shadowforest', 'lavafort', 'void', 'ruins', 'abyss', 'storm', 'chaos', 'boss'];
const E_ICONS = ['⚔️', '🦾', '🧿', '🔥', '💀', '👹', '🦂', '🐺', '🦅', '🧨'];
const E_EYES = ['#ff2200', '#00d4ff', '#88ff44', '#ff44ff', '#ffd700', '#00ffcc', '#ff8800'];
for (let n = LEVELS.length + 1; n <= MAX_LEVELS; n++) {
  const s = n - 20;
  const boss = n % BOSS_EVERY === 0;
  const hp = Math.floor(420 + s * 18 + (boss ? 140 : 0));
  const p0 = 38 + Math.floor(s * 0.6), k0 = 50 + Math.floor(s * 0.8), sp0 = 74 + Math.floor(s * 1.0);
  const p1 = p0 + 22 + Math.floor(s * 0.2), k1 = k0 + 30 + Math.floor(s * 0.2), sp1 = sp0 + 40 + Math.floor(s * 0.35);
  const lvlName = `${EXTRA_NAMES[s % EXTRA_NAMES.length]} ${Math.floor(s / EXTRA_NAMES.length) + 1}`;
  const eye = E_EYES[s % E_EYES.length];
  LEVELS.push({
    n,
    nm: lvlName,
    bg: BG_POOL[s % BG_POOL.length],
    time: Math.max(22, 30 - Math.floor(s / 8)),
    bon: boss ? 0 : Math.max(0, 16 - Math.floor(s / 10)),
    e: {
      id: `asc_${n}`,
      nm: boss ? `OVERLORD ${n}` : `ASCENDANT ${n}`,
      ico: E_ICONS[s % E_ICONS.length],
      hp,
      sz: Math.min(2.4, 1.9 + s * 0.012 + (boss ? 0.08 : 0)),
      c1: `hsl(${(s * 29) % 360} 65% 18%)`,
      c2: `hsl(${(s * 29 + 20) % 360} 70% 26%)`,
      c3: `hsl(${(s * 29 + 45) % 360} 78% 34%)`,
      skin: `hsl(${(s * 17 + 25) % 360} 40% 58%)`,
      eye,
      hair: '#08080f',
      pR: [p0, p1],
      kR: [k0, k1],
      sR: [sp0, sp1],
      miss: Math.max(.01, .03 - s * .0002),
      boss,
      taunts: boss ? [`I rule level ${n}. Kneel!`, `You cannot pass level ${n}.`] : [`You made it to ${n}? Not for long.`, `Level ${n} ends here.`]
    }
  });
}

// ═══════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════
let playerName = '', selChar = 0, playerData = null, levelData = null;
let G = {}, RAF = null, TID = null, totalSc = 0, curLv = 1, curTab = 'levels';
const rng = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const wait = ms => new Promise(r => setTimeout(r, ms));

// Build char select cards on load
(function buildCharCards() {
  const g = document.getElementById('csel-grid');
  CHARS.forEach((ch, i) => {
    const d = document.createElement('div');
    d.className = 'cscard' + (i === 0 ? ' sel' : '');
    d.innerHTML = `<div class="csbadge">✓</div><span class="cs-ico">${ch.ico}</span><span class="cs-nm">${ch.name}</span><span class="cs-tag">"${ch.tag}"</span>
      <div class="cs-sr"><span class="cs-sl">ATK</span><div class="cs-sb"><div class="cs-sf fa" style="width:${ch.atk * 18}%"></div></div></div>
      <div class="cs-sr"><span class="cs-sl">DEF</span><div class="cs-sb"><div class="cs-sf fd" style="width:${ch.def * 18}%"></div></div></div>
      <div class="cs-sr"><span class="cs-sl">SPD</span><div class="cs-sb"><div class="cs-sf fs" style="width:${ch.spd * 18}%"></div></div></div>`;
    d.addEventListener('click', () => { sfxSel(); selChar = i; document.querySelectorAll('.cscard').forEach((c, j) => c.classList.toggle('sel', j === i)); updateCharPrev(); });
    g.appendChild(d);
  });
})();
function updateCharPrev() { const ch = CHARS[selChar]; document.getElementById('csel-prev').innerHTML = `<div style="display:flex;align-items:center;gap:11px;text-align:left;"><span style="font-size:2rem;">${ch.ico}</span><div><span style="font-family:'Bebas Neue',sans-serif;font-size:1.3rem;color:#fff;display:block;">${ch.name}</span><span style="font-size:.62rem;color:rgba(255,255,255,.32);display:block;">${ch.desc}</span><span style="font-family:'Orbitron',monospace;font-size:.46rem;color:rgba(255,255,255,.3);">HP:${ch.hp} · ${ch.pR[0]}–${ch.sR[1]} DMG</span></div></div>`; }

// ═══════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════
function goTo(id) { document.querySelectorAll('.pg').forEach(p => p.classList.add('hidden')); if (id === '__fight__') return; const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function hideFightUI() { ['fhud', 'ldots', 'fctrl'].forEach(id => { document.getElementById(id).style.display = 'none'; }); }
function showFightUI() { document.getElementById('fhud').style.display = 'grid'; document.getElementById('ldots').style.display = 'flex'; document.getElementById('fctrl').style.display = 'block'; }

document.getElementById('pg-splash').addEventListener('click', () => { sfxNav(); goTo('pg-instr'); });

// ═══════════════════════════════════════════════
//  LOGIN
// ═══════════════════════════════════════════════
async function initLogin() {
  const players = await getAllPlayers();
  const lb = await getLB();
  if (players.length > 0) {
    document.getElementById('saved-wrap').style.display = 'block';
    document.getElementById('saved-chips').innerHTML = players.slice(0, 6).map(p => `<div class="chip" onclick="quickLogin('${p.name}')"><span>${CHARS[p.charId || 0]?.ico || '🔥'}</span><span>${p.name}</span><span class="chip-lv">LV${p.maxLevel || 0} · ${p.highScore || 0} · 🪙${p.coins || 0}</span></div>`).join('');
  }
  const last = await dbGet(K.cu);
  if (last) document.getElementById('name-input').value = last;
}
async function quickLogin(n) { sfxSel(); document.getElementById('name-input').value = n; await doLogin(); }
async function doLogin() {
  sfxNav();
  let n = document.getElementById('name-input').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (n.length < 2) { document.getElementById('name-input').style.borderColor = 'var(--red)'; setTimeout(() => document.getElementById('name-input').style.borderColor = '', 1200); return; }
  playerName = n;
  playerData = await loadPlayer(playerName) || basePlayer();
  levelData = await loadLevelData(playerName);
  selChar = playerData.charId || 0;
  const maxDone = levelData.maxLevel || 0;
  const prog = await loadProgress(playerName);
  const maxUnlocked = Math.max(1, Math.min(maxDone + 1, MAX_LEVELS));
  totalSc = Math.max(0, prog.totalSc || 0);
  selChar = typeof prog.selChar === 'number' ? prog.selChar : selChar;
  curLv = Math.max(1, Math.min(prog.curLv || maxUnlocked, maxUnlocked));
  await saveProgress(playerName, { curLv, totalSc, selChar, lastLevelPlayed: curLv });
  renderCharSelect(curLv);
  goTo('pg-char');
  startBGM();
}
document.getElementById('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

// ═══════════════════════════════════════════════
//  HOME DASHBOARD
// ═══════════════════════════════════════════════
async function renderHome() {
  playerData = await loadPlayer(playerName) || basePlayer();
  levelData = await loadLevelData(playerName);
  const ch = CHARS[playerData.charId || 0];
  document.getElementById('hp-ico').textContent = ch.ico;
  document.getElementById('hp-name').textContent = playerName;
  document.getElementById('hp-lv').textContent = `LV ${levelData.maxLevel || 0} · ${playerData.highScore || 0} BEST · ⚡${playerData.bankPts || 0} · 🪙${playerData.coins || 0}`;
  switchTab(curTab);
}
function getAchievements() {
  const done = (levelData && levelData.completed) || [];
  return [
    { ok: (playerData?.totalWins || 0) >= 1, txt: 'FIRST BLOOD' },
    { ok: done.includes(5), txt: 'BOSS SLAYER' },
    { ok: done.includes(10), txt: 'DEMON BREAKER' },
    { ok: done.includes(MAX_LEVELS) || playerData?.champion, txt: 'SHADOW CHAMPION' }
  ];
}
function canClaimDaily() {
  const today = new Date().toISOString().slice(0, 10);
  return (playerData?.lastDailyClaim || '') !== today;
}
function switchTab(tab) {
  curTab = tab;
  ['levels', 'shop', 'account', 'lb'].forEach(t => document.getElementById('tab-' + t).classList.toggle('active', t === tab));
  if (tab === 'levels') { loadLevelData(playerName).then(d => { levelData = d; renderLevelsTab(); }); }
  else if (tab === 'shop') renderShopTab();
  else if (tab === 'account') renderAccountTab();
  else renderLBTab();
}
function renderLevelsTab() {
  const maxDone = levelData.maxLevel || 0, nextU = Math.min(maxDone + 1, MAX_LEVELS), pct = Math.round(maxDone / MAX_LEVELS * 100);
  let h = `<div class="lvhdr"><div><span style="font-family:'Orbitron',monospace;font-size:.5rem;color:rgba(255,255,255,.28);">${maxDone}/${MAX_LEVELS} DONE</span></div><div style="display:flex;align-items:center;gap:5px;"><div class="pbw"><div class="pbf" style="width:${pct}%"></div></div><span class="ppct">${pct}%</span></div></div>
  <div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
    <div><div style="font-family:'Orbitron',monospace;font-size:.46rem;letter-spacing:.16em;color:rgba(255,255,255,.24);">DAILY REWARD</div><div style="font-size:.58rem;color:rgba(255,255,255,.34);">Claim once per day for score, arena PTS (⚡), and coins.</div></div>
    <button class="btn ${canClaimDaily() ? 'btn-fire' : 'btn-ghost'} btn-sm" ${canClaimDaily() ? '' : 'disabled'} onclick="claimDailyReward()">${canClaimDaily() ? 'CLAIM +250' : 'CLAIMED'}</button>
  </div>
  <div class="lgrid">`;
  LEVELS.forEach(lv => {
    const done = levelData.completed?.includes(lv.n), locked = lv.n > nextU, isNxt = lv.n === nextU && !done;
    const sc = levelData.scores?.[lv.n], stars = sc ? sc.stars || 0 : 0;
    let cls = 'lc'; if (locked) cls += ' locked'; else if (done) cls += ' done'; if (lv.e.boss) cls += ' boss-c'; if (isNxt) cls += ' nxt';
    h += `<div class="${cls}" onclick="selectLevel(${lv.n})" title="LV${lv.n}: ${lv.nm}">
      ${lv.e.boss ? '<span class="lbadge lb-boss">BOSS</span>' : ''}
      ${done ? '<span class="lbadge lb-done" style="right:3px;left:auto;">✓</span>' : ''}
      ${isNxt ? '<span class="lbadge lb-nxt" style="right:3px;left:auto;">▶</span>' : ''}
      <span class="lc-num">LV ${lv.n}</span><span class="lc-ico">${lv.e.ico}</span>
      <span class="lc-name">${lv.nm.split(' ').slice(0, 2).join(' ')}</span>
      <span class="lc-stars">${'⭐'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
    </div>`;
  });
  document.getElementById('home-content').innerHTML = h + '</div>';
}
async function selectLevel(n) { const maxDone = levelData.maxLevel || 0; if (n > maxDone + 1) return; sfxSel(); curLv = n; await saveProgress(playerName, { curLv, totalSc, selChar, lastLevelPlayed: n }); renderCharSelect(n); goTo('pg-char'); }
function renderAccountTab() {
  const ch = CHARS[selChar], maxDone = levelData.maxLevel || 0, pct = Math.round(maxDone / MAX_LEVELS * 100);
  const ach = getAchievements();
  document.getElementById('home-content').innerHTML = `
  <div class="acchero"><span class="accico">${ch.ico}</span><span class="accname">${playerName}</span><span class="acctitle">"${ch.tag}"</span></div>
  <div class="sgrid">
    <div class="sb"><span class="sv" style="color:var(--gold)">${playerData.highScore || 0}</span><span class="sl">HIGH SCORE</span></div>
    <div class="sb"><span class="sv" style="color:var(--green)">${maxDone}</span><span class="sl">MAX LEVEL</span></div>
    <div class="sb"><span class="sv" style="color:var(--ice)">${playerData.totalWins || 0}</span><span class="sl">TOTAL WINS</span></div>
    <div class="sb"><span class="sv" style="color:var(--ember)">${playerData.coins || 0}</span><span class="sl">COINS</span></div>
    <div class="sb"><span class="sv" style="color:#88ccff">${playerData.bankPts || 0}</span><span class="sl">ARENA PTS</span></div>
    <div class="sb"><span class="sv" style="color:#bb88ff">${(playerData.shopInv && playerData.shopInv.extraSp || 0) + (playerData.shopInv && playerData.shopInv.extraHeal || 0)}</span><span class="sl">STASH ITEMS</span></div>
  </div>
  <div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:7px;padding:9px 12px;margin-bottom:12px;">
    <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="font-family:'Orbitron',monospace;font-size:.46rem;color:rgba(255,255,255,.22);">GAUNTLET PROGRESS</span><span style="font-family:'Orbitron',monospace;font-size:.46rem;color:var(--gold);">${pct}%</span></div>
    <div style="height:7px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${pct}%;border-radius:3px;background:linear-gradient(90deg,var(--fire),var(--gold));"></div></div>
    <div style="font-size:.58rem;color:rgba(255,255,255,.22);margin-top:5px;text-align:center;">${maxDone} of ${MAX_LEVELS} levels completed</div>
  </div>
  <div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:7px;padding:9px 12px;margin-bottom:12px;">
    <div style="font-family:'Orbitron',monospace;font-size:.46rem;letter-spacing:.16em;color:rgba(255,255,255,.24);margin-bottom:7px;">ACHIEVEMENTS</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      ${ach.map(a => `<div style="border:1px solid ${a.ok ? 'rgba(255,215,0,.28)' : 'var(--border)'};background:${a.ok ? 'rgba(255,215,0,.08)' : 'rgba(255,255,255,.02)'};border-radius:6px;padding:7px 8px;font-size:.56rem;color:${a.ok ? '#ffd700' : 'rgba(255,255,255,.36)'};">${a.ok ? '🏅' : '🔒'} ${a.txt}</div>`).join('')}
    </div>
  </div>
  <div class="divider" style="margin:9px 0;"></div>
  <span class="cswlbl">— CHANGE FIGHTER —</span>
  <div class="crow">${CHARS.map((c, i) => `<div class="cmi ${i === selChar ? 'sel' : ''}" onclick="switchChar(${i})">
    <span class="cmi-ico">${c.ico}</span><span class="cmi-nm">${c.name}</span>
    <div class="msr"><span class="msl">ATK</span><div class="msb"><div class="msf fa" style="width:${c.atk * 18}%"></div></div></div>
    <div class="msr"><span class="msl">DEF</span><div class="msb"><div class="msf fd" style="width:${c.def * 18}%"></div></div></div>
  </div>`).join('')}</div>`;
}
async function switchChar(i) { sfxSel(); selChar = i; await savePlayer(playerName, { charId: i }); playerData = await loadPlayer(playerName); renderAccountTab(); document.getElementById('hp-ico').textContent = CHARS[i].ico; }
function renderShopTab() {
  const inv = mergeShopInv(playerData.shopInv);
  const bp = playerData.bankPts || 0, co = playerData.coins || 0;
  const invLine = `Stash — 💥×${inv.extraSp} · 💊×${inv.extraHeal} · ⚡pwr×${inv.dmgBoost} · 🔥rage×${inv.rageAmp} · 🔗×${inv.comboElixir}`;
  const cards = SHOP_ITEMS.map(it => {
    const ok = bp >= it.pts && co >= it.coins;
    const price = [it.pts ? `⚡ ${it.pts}` : '', it.coins ? `🪙 ${it.coins}` : ''].filter(Boolean).join(' · ');
    return `<div class="shop-card">
      <span class="sci">${it.ico}</span>
      <div class="sctx">
        <div class="scn">${it.name}</div>
        <div class="scd">${it.desc}</div>
        <div class="scp">${price}</div>
        <button class="btn-shop" ${ok ? '' : 'disabled'} onclick="buyShopItem('${it.id}')">BUY</button>
      </div>
    </div>`;
  }).join('');
  document.getElementById('home-content').innerHTML = `
  <div class="shop-hdr">ARENA SUPPLY — spend ⚡ arena PTS & 🪙 coins</div>
  <div class="shop-bal">
    <div class="sb"><span class="sv" style="color:#88ccff">${bp}</span><span class="sl">ARENA PTS</span></div>
    <div class="sb"><span class="sv" style="color:var(--ember)">${co}</span><span class="sl">COINS</span></div>
  </div>
  <div class="shop-note">${invLine}<br>One of each buff type is used automatically at the start of the next fight (stacks carry over).</div>
  <div class="shop-grid">${cards}</div>`;
}
async function buyShopItem(id) {
  const it = SHOP_ITEMS.find(x => x.id === id); if (!it) return;
  playerData = await loadPlayer(playerName) || basePlayer();
  const bp = playerData.bankPts || 0, co = playerData.coins || 0;
  if (bp < it.pts || co < it.coins) { sfxLose(); return; }
  const nextInv = mergeShopInv(playerData.shopInv);
  Object.keys(it.inc).forEach(k => { nextInv[k] = (nextInv[k] || 0) + it.inc[k]; });
  await savePlayer(playerName, { bankPts: bp - it.pts, coins: co - it.coins, shopInv: nextInv });
  playerData = await loadPlayer(playerName);
  sfxUnlock();
  document.getElementById('hp-lv').textContent = `LV ${levelData.maxLevel || 0} · ${playerData.highScore || 0} BEST · ⚡${playerData.bankPts || 0} · 🪙${playerData.coins || 0}`;
  renderShopTab();
  await rebuildLeaderboard();
}
async function renderLBTab() {
  await rebuildLeaderboard();
  const lb = await getLB();
  window.cachedLB = lb;
  if (!lb.length) { document.getElementById('home-content').innerHTML = '<div class="lb-empty">No champions yet. Be the first!</div>'; return; }
  const ranks = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '11', '12'];
  document.getElementById('home-content').innerHTML = '<div class="lbw">' + lb.map((e, i) => `
    <div class="lbrow ${e.name === playerName ? 'me' : ''}">
      <span class="lbrk">${ranks[i] || i + 1}</span>
      <div class="lbpi"><div class="lbpn">${e.name} <span class="lbpc">${CHARS.find(c => c.name === e.char)?.ico || '⚔️'}</span>${e.name === playerName ? `<span style="font-size:.44rem;color:var(--fire);font-family:'Orbitron',monospace;"> YOU</span>` : ''}</div><div class="lbps">${e.char || 'FIGHTER'} · ${e.date || ''}</div>
      <div class="lb-meta">🪙 ${e.coins ?? 0} coins · ⚡ ${e.bankPts ?? 0} arena · 🏅 ${e.wins ?? 0} wins</div></div>
      <div class="lbsw"><span class="lbsv">${e.score}</span><span class="lbsl">BEST SCORE</span><span class="lbsl" style="margin-top:2px;">MAX LV ${e.lv || '?'}</span></div>
    </div>`).join('') + '</div>';
}
async function goToCharSelect() { sfxNav(); const maxDone = levelData ? levelData.maxLevel || 0 : 0; curLv = Math.min(maxDone + 1, MAX_LEVELS); await saveProgress(playerName, { curLv, totalSc, selChar, lastLevelPlayed: curLv }); renderCharSelect(curLv); goTo('pg-char'); }
async function continueRun() {
  sfxNav();
  levelData = await loadLevelData(playerName);
  const prog = await loadProgress(playerName);
  const maxAllowed = Math.max(1, Math.min((levelData.maxLevel || 0) + 1, MAX_LEVELS));
  curLv = Math.max(1, Math.min(prog.curLv || maxAllowed, maxAllowed));
  totalSc = Math.max(0, prog.totalSc || 0);
  selChar = typeof prog.selChar === 'number' ? prog.selChar : selChar;
  await saveProgress(playerName, { curLv, totalSc, selChar, lastLevelPlayed: curLv });
  renderCharSelect(curLv);
  goTo('pg-char');
}
async function claimDailyReward() {
  if (!canClaimDaily()) return;
  const today = new Date().toISOString().slice(0, 10);
  const bonusScore = 250, bonusCoins = 25, bonusBank = 120;
  playerData = await loadPlayer(playerName) || basePlayer();
  totalSc = (totalSc || 0) + bonusScore;
  const nextCoins = (playerData.coins || 0) + bonusCoins;
  const nextBank = (playerData.bankPts || 0) + bonusBank;
  await savePlayer(playerName, {
    charId: selChar,
    coins: nextCoins,
    bankPts: nextBank,
    lastDailyClaim: today,
    totalScore: (playerData.totalScore || 0) + bonusScore,
    highScore: Math.max(playerData.highScore || 0, totalSc)
  });
  await saveProgress(playerName, { curLv, totalSc, selChar, lastLevelPlayed: curLv });
  playerData = await loadPlayer(playerName);
  showAnn(`DAILY +${bonusScore} SCORE · ⚡+${bonusBank} · +${bonusCoins} COINS`, '#ffd700');
  sfxUnlock();
  renderLevelsTab();
  document.getElementById('hp-lv').textContent = `LV ${levelData.maxLevel || 0} · ${playerData.highScore || 0} BEST · ⚡${playerData.bankPts || 0} · 🪙${playerData.coins || 0}`;
  await rebuildLeaderboard();
}
function renderCharSelect(lvNum) {
  document.getElementById('csel-player').textContent = playerName;
  const lv = LEVELS[(lvNum || curLv) - 1];
  document.getElementById('csel-level-info').innerHTML = lv ? `<div class="cslvinfo">
    <span style="font-size:1.7rem;">${lv.e.ico}</span>
    <div><div style="font-family:'Orbitron',monospace;font-size:.44rem;letter-spacing:.2em;color:rgba(255,255,255,.2);margin-bottom:2px;">FIGHTING NEXT</div>
    <div style="font-family:'Bebas Neue',sans-serif;font-size:1rem;color:#fff;">LV ${lv.n} · ${lv.nm}</div>
    <div style="font-size:.58rem;color:rgba(255,255,255,.28);">${lv.e.nm} · HP: ${lv.e.hp}${lv.e.boss ? ' · <span style="color:#ff66aa">⚠ BOSS</span>' : ''}</div></div>
  </div>`: '';
  document.querySelectorAll('.cscard').forEach((c, j) => c.classList.toggle('sel', j === selChar));
  updateCharPrev();
}
async function goToHomeFromChar() { sfxNav(); await savePlayer(playerName, { charId: selChar }); playerData = await loadPlayer(playerName); levelData = await loadLevelData(playerName); await renderHome(); goTo('pg-home'); }
async function startFight() { sfxNav(); await savePlayer(playerName, { charId: selChar }); await saveProgress(playerName, { curLv, totalSc, selChar, lastLevelPlayed: curLv }); playerData = await loadPlayer(playerName) || basePlayer(); goTo('__fight__'); showFightUI(); await loadLevel(curLv, true); }

// ═══════════════════════════════════════════════
//  CANVAS
// ═══════════════════════════════════════════════
const CV = document.getElementById('bgcanvas'), CX = CV.getContext('2d');
function rsz() { CV.width = innerWidth; CV.height = innerHeight; } rsz(); window.addEventListener('resize', rsz);
if (!CanvasRenderingContext2D.prototype.roundRect) { CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); this.beginPath(); this.moveTo(x + r, y); this.lineTo(x + w - r, y); this.quadraticCurveTo(x + w, y, x + w, y + r); this.lineTo(x + w, y + h - r); this.quadraticCurveTo(x + w, y + h, x + w - r, y + h); this.lineTo(x + r, y + h); this.quadraticCurveTo(x, y + h, x, y + h - r); this.lineTo(x, y + r); this.quadraticCurveTo(x, y, x + r, y); this.closePath(); }; }

let PX = [], FLT = [];
function spart(x, y, col, n, tp) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = Math.random() * 8 + 2; PX.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (tp === 'blood' ? 4 : .5), life: 1, dc: Math.random() * .045 + .022, sz: Math.random() * (tp === 'blood' ? 7 : 4) + 1.5, col, tp, gv: tp === 'blood' ? .22 : .08 }); } }
function tickPX(dt) { const gY = CV.height * .72; const vxF = Math.pow(0.94, dt); PX = PX.filter(p => { if (p.tp === 'blood' && p.y >= gY) { p.y = gY; p.vy = 0; p.vx = 0; p.dc = 0.001; } p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.gv * dt; p.vx *= vxF; p.life -= p.dc * dt; return p.life > 0; }); }
function drawPX() { PX.forEach(p => { CX.save(); CX.globalAlpha = p.life; CX.fillStyle = p.col; if (p.tp === 'spark') { CX.shadowBlur = 14; CX.shadowColor = p.col; } CX.beginPath(); if (p.tp === 'blood' && p.vy === 0) { CX.ellipse(p.x, p.y, p.sz * 1.8, p.sz * .5, 0, 0, Math.PI * 2); } else { CX.arc(p.x, p.y, p.sz, 0, Math.PI * 2); } CX.fill(); CX.restore(); }); }
function sflt(x, y, t, col) { FLT.push({ x, y, t, col, life: 1, vy: -2.8, sc: 1.5 }); }
function drawFLT(dt) { const vyF = Math.pow(0.93, dt || 1), scF = Math.pow(0.97, dt || 1); FLT = FLT.filter(f => { f.y += f.vy * dt; f.vy *= vyF; f.life -= 0.018 * dt; f.sc = Math.max(1, f.sc * scF); if (f.life <= 0) return false; CX.save(); CX.globalAlpha = f.life; CX.font = `900 ${Math.floor(34 * f.sc)}px 'Bebas Neue',sans-serif`; CX.textAlign = 'center'; CX.textBaseline = 'middle'; CX.strokeStyle = 'rgba(0,0,0,.95)'; CX.lineWidth = 6; CX.strokeText(f.t, f.x, f.y); CX.fillStyle = f.col; CX.fillText(f.t, f.x, f.y); CX.restore(); return true; }); }
let SK = { x: 0, y: 0, p: 0 };
function doShake(p) { SK.p = Math.max(SK.p, p); }
function applyShake(dt) { if (SK.p < .3) { SK.p = 0; SK.x = SK.y = 0; return; } SK.x = (Math.random() - .5) * SK.p * 2; SK.y = (Math.random() - .5) * SK.p * 2; SK.p *= Math.pow(0.72, dt || 1); }
let IMP = 0;
function doImpact(v) { IMP = Math.max(IMP, v); }
function drawImp(dt) { if (IMP < .01) return; CX.save(); CX.globalAlpha = IMP; CX.fillStyle = '#fff'; CX.fillRect(0, 0, CV.width, CV.height); CX.restore(); IMP *= Math.pow(0.52, dt || 1); }

// ═══════════════════════════════════════════════
//  REALISTIC FIGHTER DRAW — human anatomy
// ═══════════════════════════════════════════════
function drawFighter(bx, gY, flip, pose, cfg, sc) {
  const c = CX; c.save();
  const H = CV.height, s = Math.min(H / 700, 1.35) * sc;
  let x = bx;
  if (flip) { c.scale(-1, 1); x = -x; }
  const bob = pose.bob || 0, st = pose.state || 'idle';

  // ── EVIL AURA for big enemies ──
  if (cfg.boss || sc >= 1.5) {
    const rings = Math.floor(sc * 2);
    for (let r = 0; r < rings; r++) {
      c.save(); c.globalAlpha = (.06 + Math.sin(Date.now() * .004 + r) * .04) * Math.min(sc * .5, 1);
      const rg = c.createRadialGradient(x, gY - 110 * s, 5, x, gY - 110 * s, 120 * s + r * 22 * s);
      rg.addColorStop(0, cfg.eye); rg.addColorStop(1, 'transparent');
      c.fillStyle = rg; c.beginPath(); c.ellipse(x, gY - 90 * s, 95 * s + r * 16 * s, 130 * s + r * 16 * s, 0, 0, Math.PI * 2); c.fill(); c.restore();
    }
    if (sc >= 1.5) {
      c.save(); c.globalAlpha = .2 + Math.sin(Date.now() * .006) * .08; c.strokeStyle = cfg.eye; c.lineWidth = 2 * s;
      for (let i = 0; i < 6; i++) { const ang = Date.now() * .001 + i * (Math.PI / 3), len = (60 + Math.sin(Date.now() * .003 + i) * 24) * s; c.beginPath(); c.moveTo(x, gY - 90 * s); c.lineTo(x + Math.cos(ang) * len, gY - 90 * s + Math.sin(ang) * len * .4); c.stroke(); }
      c.restore();
    }
  }

  // ── DEATH POSE ──
  if (st === 'dead') {
    drawDeadFighter(c, x, gY, s, cfg, pose.deathProgress || 1);
    c.restore(); return;
  }

  // ── BLOCK SHIELD ──
  if (st === 'block') {
    c.save(); c.globalAlpha = .3 + Math.sin(Date.now() * .01) * .12;
    const sg = c.createRadialGradient(x + 30 * s, gY - 80 * s, 5, x + 30 * s, gY - 80 * s, 55 * s);
    sg.addColorStop(0, 'rgba(255,215,0,.6)'); sg.addColorStop(1, 'rgba(255,215,0,0)');
    c.fillStyle = sg; c.beginPath(); c.ellipse(x + 30 * s, gY - 80 * s, 50 * s, 60 * s, 0, 0, Math.PI * 2); c.fill(); c.restore();
  }

  // Ground shadow
  c.save(); c.globalAlpha = .28 + sc * .07; c.fillStyle = '#000'; c.beginPath(); c.ellipse(x, gY + 5 * s, 44 * s * sc * .62, 11 * s, 0, 0, Math.PI * 2); c.fill(); c.restore();

  // ── POSE OFFSETS ──
  let lLegX = 0, lLegY = 0, rLegX = 0, rLegY = 0;
  let lArmTX = 0, lArmTY = 0, rArmTX = 0, rArmTY = 0;
  let torsoTilt = 0, headBob = bob;

  if (st === 'punch' || st === 'attack') { rArmTX = 68 * s; rArmTY = -18 * s; torsoTilt = 0.12; headBob = bob - 3; }
  else if (st === 'kick') { rLegX = 60 * s; rLegY = -68 * s; lLegX = -8 * s; torsoTilt = -0.08; }
  else if (st === 'special') { rArmTX = 55 * s; rArmTY = -35 * s; lArmTX = -20 * s; lArmTY = -20 * s; torsoTilt = 0.18; headBob = bob - 5; }
  else if (st === 'block') { rArmTX = 22 * s; rArmTY = -30 * s; lArmTX = 8 * s; lArmTY = -20 * s; }
  else if (st === 'hurt') { lLegX = -5 * s; torsoTilt = -0.2; rArmTX = -15 * s; rArmTY = 10 * s; }
  else if (st === 'walk_fwd') { lLegX = -10 * s; lLegY = -8 * s; rLegX = 10 * s; rLegY = 8 * s; }
  else if (st === 'walk_back') { lLegX = 10 * s; lLegY = 8 * s; rLegX = -10 * s; rLegY = -8 * s; }
  else {// idle
    rArmTX = -5 * s; rArmTY = 8 * s;
    lArmTX = 5 * s; lArmTY = 8 * s;
  }

  // ── LEGS ──
  const ankleL = { x: x - 14 * s + lLegX, y: gY + lLegY + bob };
  const ankleR = { x: x + 14 * s + rLegX, y: gY + rLegY + bob };
  const hipL = { x: x - 12 * s, y: gY - 50 * s + bob };
  const hipR = { x: x + 12 * s, y: gY - 50 * s + bob };
  // thigh L
  drawLimb2(c, hipL.x, hipL.y, ankleL.x - hipL.x, ankleL.y - hipL.y, 13 * s, cfg.c1);
  // shin L (slightly bent)
  c.fillStyle = cfg.c2; c.beginPath(); c.ellipse(ankleL.x, ankleL.y, 9 * s, 6 * s, 0, 0, Math.PI * 2); c.fill();
  // boot L
  c.fillStyle = '#111'; c.beginPath(); c.moveTo(ankleL.x - 12 * s, ankleL.y + 2 * s); c.lineTo(ankleL.x + 16 * s, ankleL.y + 2 * s); c.lineTo(ankleL.x + 18 * s, ankleL.y + 8 * s); c.lineTo(ankleL.x - 13 * s, ankleL.y + 8 * s); c.closePath(); c.fill();
  // thigh R
  drawLimb2(c, hipR.x, hipR.y, ankleR.x - hipR.x, ankleR.y - hipR.y, 14 * s, cfg.c1);
  c.fillStyle = cfg.c2; c.beginPath(); c.ellipse(ankleR.x, ankleR.y, 10 * s, 6 * s, 0, 0, Math.PI * 2); c.fill();
  // boot R
  c.fillStyle = '#151515'; c.beginPath(); c.moveTo(ankleR.x - 13 * s, ankleR.y + 2 * s); c.lineTo(ankleR.x + 17 * s, ankleR.y + 2 * s); c.lineTo(ankleR.x + 19 * s, ankleR.y + 8 * s); c.lineTo(ankleR.x - 14 * s, ankleR.y + 8 * s); c.closePath(); c.fill();

  // ── TORSO ──
  const ty = gY - 55 * s + bob;
  c.save(); c.translate(x, ty + 25 * s); c.rotate(torsoTilt);
  // pelvis
  c.fillStyle = cfg.c2; c.beginPath(); c.roundRect(-18 * s, -10 * s, 36 * s, 20 * s, 4 * s); c.fill();
  // belt
  c.fillStyle = '#1a1a1a'; c.beginPath(); c.roundRect(-19 * s, -3 * s, 38 * s, 8 * s, 2 * s); c.fill();
  c.fillStyle = '#666'; c.beginPath(); c.roundRect(-4 * s, -2 * s, 8 * s, 6 * s, 2 * s); c.fill();
  // torso main
  c.fillStyle = cfg.c1; c.beginPath(); c.moveTo(-20 * s, -10 * s); c.lineTo(-22 * s, -42 * s); c.lineTo(22 * s, -42 * s); c.lineTo(20 * s, -10 * s); c.closePath(); c.fill();
  // pec muscles
  c.fillStyle = cfg.c2; c.beginPath(); c.ellipse(-10 * s, -30 * s, 10 * s, 8 * s, 0.15, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(10 * s, -30 * s, 10 * s, 8 * s, -0.15, 0, Math.PI * 2); c.fill();
  // ab lines
  c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 1.5 * s;
  [-20 * s, -30 * s].forEach(ay => { c.beginPath(); c.moveTo(-12 * s, ay); c.lineTo(12 * s, ay); c.stroke(); });
  c.beginPath(); c.moveTo(0, -10 * s); c.lineTo(0, -42 * s); c.stroke();
  // chest armor plate
  c.fillStyle = cfg.c3 || cfg.c2; c.beginPath(); c.roundRect(-13 * s, -42 * s, 26 * s, 14 * s, 3 * s); c.fill();
  c.fillStyle = 'rgba(255,255,255,.08)'; c.beginPath(); c.roundRect(-12 * s, -41 * s, 24 * s, 6 * s, 2 * s); c.fill();
  c.restore();

  // ── ARMS ──
  const shoulderL = { x: x - 22 * s, y: ty - 14 * s + bob };
  const shoulderR = { x: x + 22 * s, y: ty - 14 * s + bob };
  const elbowL = { x: shoulderL.x - 8 * s + lArmTX * .3, y: shoulderL.y + 20 * s + lArmTY * .3 };
  const wristL = { x: shoulderL.x + lArmTX, y: shoulderL.y + 38 * s + lArmTY };
  const elbowR = { x: shoulderR.x + 8 * s + rArmTX * .3, y: shoulderR.y + 20 * s + rArmTY * .3 };
  const wristR = { x: shoulderR.x + rArmTX, y: shoulderR.y + 38 * s + rArmTY };

  // upper arm L
  drawLimb2(c, shoulderL.x, shoulderL.y, elbowL.x - shoulderL.x, elbowL.y - shoulderL.y, 11 * s, cfg.c1);
  // forearm L
  drawLimb2(c, elbowL.x, elbowL.y, wristL.x - elbowL.x, wristL.y - elbowL.y, 9 * s, cfg.c2);
  // fist L
  drawFist2(c, wristL.x, wristL.y, 12 * s, cfg.c1, cfg.skin);

  // upper arm R
  drawLimb2(c, shoulderR.x, shoulderR.y, elbowR.x - shoulderR.x, elbowR.y - shoulderR.y, 12 * s, cfg.c1);
  // forearm R
  drawLimb2(c, elbowR.x, elbowR.y, wristR.x - elbowR.x, wristR.y - elbowR.y, 10 * s, cfg.c2);
  // fist R (punching fist bigger)
  drawFist2(c, wristR.x, wristR.y, (st === 'punch' || st === 'attack') ? 15 * s : 13 * s, cfg.c1, cfg.skin);

  // ── HEAD ──
  const headY = ty - 58 * s + headBob;
  const headX = x + torsoTilt * 20 * s;
  // neck
  c.fillStyle = cfg.skin; c.beginPath(); c.roundRect(headX - 7 * s, headY + 22 * s, 14 * s, 20 * s, 3 * s); c.fill();
  // head shape — more realistic oval
  c.fillStyle = cfg.skin; c.beginPath(); c.ellipse(headX, headY, 20 * s, 24 * s, 0, 0, Math.PI * 2); c.fill();
  // jaw/chin
  c.fillStyle = cfg.skin; c.beginPath(); c.ellipse(headX, headY + 18 * s, 15 * s, 10 * s, 0, 0, Math.PI * 2); c.fill();
  // hair / helmet
  c.fillStyle = cfg.hair || '#111';
  c.beginPath(); c.ellipse(headX, headY - 8 * s, 20 * s, 18 * s, 0, Math.PI, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(headX, headY - 6 * s, 22 * s, 16 * s, 0, Math.PI, Math.PI * 2); c.fill();
  // side burns
  c.beginPath(); c.ellipse(headX - 19 * s, headY + 2 * s, 5 * s, 10 * s, 0.2, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(headX + 19 * s, headY + 2 * s, 5 * s, 10 * s, -0.2, 0, Math.PI * 2); c.fill();
  // eye sockets
  c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(headX - 8 * s, headY - 2 * s, 7 * s, 5 * s, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(headX + 8 * s, headY - 2 * s, 7 * s, 5 * s, 0, 0, Math.PI * 2); c.fill();
  // eyes glow
  c.fillStyle = cfg.eye; c.shadowBlur = cfg.eg || 14; c.shadowColor = cfg.eye;
  c.beginPath(); c.ellipse(headX - 8 * s, headY - 2 * s, 4.5 * s, 3.5 * s, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(headX + 8 * s, headY - 2 * s, 4.5 * s, 3.5 * s, 0, 0, Math.PI * 2); c.fill();
  // pupils
  c.fillStyle = 'rgba(0,0,0,.8)'; c.shadowBlur = 0;
  c.beginPath(); c.ellipse(headX - 8 * s, headY - 2 * s, 2 * s, 2 * s, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(headX + 8 * s, headY - 2 * s, 2 * s, 2 * s, 0, 0, Math.PI * 2); c.fill();
  // nose
  c.fillStyle = cfg.skin; c.beginPath(); c.ellipse(headX, headY + 5 * s, 4 * s, 5 * s, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(0,0,0,.2)'; c.beginPath(); c.ellipse(headX - 3 * s, headY + 8 * s, 2 * s, 1.5 * s, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(headX + 3 * s, headY + 8 * s, 2 * s, 1.5 * s, 0, 0, Math.PI * 2); c.fill();
  // mouth
  c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1.5 * s; c.lineCap = 'round';
  if (st === 'hurt' || st === 'dead') { c.beginPath(); c.moveTo(headX - 6 * s, headY + 13 * s); c.quadraticCurveTo(headX, headY + 17 * s, headX + 6 * s, headY + 13 * s); c.stroke(); }
  else { c.beginPath(); c.moveTo(headX - 5 * s, headY + 14 * s); c.lineTo(headX + 5 * s, headY + 14 * s); c.stroke(); }

  // boss extras — horns and crown
  if (cfg.boss || sc >= 1.5) {
    c.fillStyle = cfg.eye; c.globalAlpha = .8; c.shadowBlur = 20; c.shadowColor = cfg.eye;
    c.beginPath(); c.moveTo(headX - 18 * s, headY - 16 * s); c.lineTo(headX - 26 * s, headY - 52 * s); c.lineTo(headX - 10 * s, headY - 40 * s); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(headX + 18 * s, headY - 16 * s); c.lineTo(headX + 26 * s, headY - 52 * s); c.lineTo(headX + 10 * s, headY - 40 * s); c.closePath(); c.fill();
    if (sc >= 1.8) { c.beginPath(); c.moveTo(headX - 6 * s, headY - 44 * s); c.lineTo(headX - 10 * s, headY - 70 * s); c.lineTo(headX - 1 * s, headY - 58 * s); c.closePath(); c.fill(); c.beginPath(); c.moveTo(headX + 6 * s, headY - 44 * s); c.lineTo(headX + 10 * s, headY - 70 * s); c.lineTo(headX + 1 * s, headY - 58 * s); c.closePath(); c.fill(); }
    c.globalAlpha = 1; c.shadowBlur = 0;
  }
  if (cfg.id === 'final') {
    c.fillStyle = '#ffd700'; c.shadowBlur = 30; c.shadowColor = '#ffd700';
    c.beginPath(); c.moveTo(headX - 18 * s, headY - 52 * s); c.lineTo(headX - 18 * s, headY - 74 * s); c.lineTo(headX - 9 * s, headY - 63 * s); c.lineTo(headX, headY - 80 * s); c.lineTo(headX + 9 * s, headY - 63 * s); c.lineTo(headX + 18 * s, headY - 74 * s); c.lineTo(headX + 18 * s, headY - 52 * s); c.closePath(); c.fill(); c.shadowBlur = 0;
  }

  // hit flash
  if (st === 'hurt') { CX.save(); CX.globalAlpha = .55; CX.fillStyle = '#fff'; CX.beginPath(); CX.ellipse(x, gY - 90 * s + bob, 48 * s, 120 * s, 0, 0, Math.PI * 2); CX.fill(); CX.restore(); }

  // rage aura
  if (pose.raging) { c.save(); c.globalAlpha = .18 + Math.sin(Date.now() * .01) * .08; const rg = c.createRadialGradient(x, gY - 90 * s, 10, x, gY - 90 * s, 80 * s); rg.addColorStop(0, 'rgba(255,80,0,.9)'); rg.addColorStop(1, 'transparent'); c.fillStyle = rg; c.beginPath(); c.ellipse(x, gY - 90 * s, 75 * s, 110 * s, 0, 0, Math.PI * 2); c.fill(); c.restore(); }

  c.restore();
}

function drawDeadFighter(c, x, gY, s, cfg, prog) {
  // prog: 0=upright, 1=fully collapsed on ground
  const tilt = Math.min(prog, 1) * 1.45; // 0 to ~83 deg forward fall
  c.save();
  c.translate(x, gY);
  c.rotate(tilt);  // rotate around feet pivot

  const t = -Math.cos(tilt); // vertical factor (1=up, 0=horizontal)
  const bodyH = 130 * s;

  // Blood pool underneath (grows as falls)
  if (prog > 0.55) {
    const bp = Math.min((prog - 0.55) * 2.2, 1);
    c.save(); c.globalAlpha = bp * .5; c.fillStyle = '#880000';
    c.beginPath(); c.ellipse(bodyH * 0.6, 0, 45 * s * bp, 10 * s * bp, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  // Legs
  c.fillStyle = cfg.c1;
  c.beginPath(); c.roundRect(-16 * s, t * -10 * s, 13 * s, bodyH * .38, 4 * s); c.fill();
  c.beginPath(); c.roundRect(3 * s, t * -10 * s, 13 * s, bodyH * .42, 4 * s); c.fill();
  // Boots
  c.fillStyle = '#111';
  c.beginPath(); c.roundRect(-18 * s, t * -10 * s + bodyH * .38, 28 * s, 10 * s, 3 * s); c.fill();
  c.beginPath(); c.roundRect(1 * s, t * -10 * s + bodyH * .42, 28 * s, 10 * s, 3 * s); c.fill();

  // Torso
  c.fillStyle = cfg.c1;
  c.beginPath(); c.roundRect(-18 * s, t * -60 * s, 36 * s, 52 * s, 5 * s); c.fill();
  c.fillStyle = cfg.c2;
  c.beginPath(); c.roundRect(-10 * s, t * -58 * s, 20 * s, 28 * s, 3 * s); c.fill();

  // Arms splayed
  c.fillStyle = cfg.c1;
  c.beginPath(); c.roundRect(-38 * s, t * -62 * s, 22 * s, 11 * s, 4 * s); c.fill();
  c.beginPath(); c.roundRect(16 * s, t * -60 * s, 22 * s, 11 * s, 4 * s); c.fill();
  // Fists
  c.fillStyle = cfg.c2;
  c.beginPath(); c.ellipse(-42 * s, t * -57 * s, 9 * s, 8 * s, 0.3, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(42 * s, t * -55 * s, 9 * s, 8 * s, -0.3, 0, Math.PI * 2); c.fill();

  // Head drooped forward
  const hx = t * -90 * s;
  const hy = t * -90 * s;
  c.fillStyle = cfg.skin;
  c.beginPath(); c.ellipse(bodyH * 0.05, t * -88 * s, 17 * s, 19 * s, tilt * 0.3, 0, Math.PI * 2); c.fill();
  // Hair
  c.fillStyle = cfg.hair || '#111';
  c.beginPath(); c.ellipse(bodyH * 0.05, t * -96 * s, 17 * s, 13 * s, tilt * 0.3, Math.PI, Math.PI * 2); c.fill();
  // X eyes
  c.strokeStyle = cfg.eye; c.lineWidth = 2.2 * s; c.shadowBlur = 8; c.shadowColor = cfg.eye;
  [[-7 * s, t * -89 * s], [7 * s, t * -89 * s]].forEach(([ex, ey]) => {
    c.beginPath(); c.moveTo(ex - 3 * s, ey - 2.5 * s); c.lineTo(ex + 3 * s, ey + 2.5 * s); c.stroke();
    c.beginPath(); c.moveTo(ex + 3 * s, ey - 2.5 * s); c.lineTo(ex - 3 * s, ey + 2.5 * s); c.stroke();
  });
  c.shadowBlur = 0;

  c.restore();

  // Dust puff when hitting ground
  if (prog > 0.82 && prog < 0.92 && Math.random() < 0.25)
    spart(x + 70 * s, gY, '#8a7a6a', 4, 'spark');
}

function drawLimb2(c, x, y, tx, ty, w, col) {
  const len = Math.sqrt(tx * tx + ty * ty); if (len < 2) return;
  c.save(); c.translate(x, y); c.rotate(Math.atan2(ty, tx));
  c.fillStyle = col; c.beginPath(); c.roundRect(0, -w / 2, len, w, w / 2); c.fill();
  // muscle highlight
  c.fillStyle = 'rgba(255,255,255,.08)'; c.beginPath(); c.roundRect(2 * w * .1, -w * .35, len * .7, w * .3, w * .15); c.fill();
  c.restore();
}
function drawFist2(c, x, y, r, col, skin) {
  // Glove/fist shape
  c.fillStyle = col; c.beginPath(); c.roundRect(x - r, y - r * .8, r * 2, r * 1.6, r * .4); c.fill();
  // knuckles
  c.fillStyle = skin || '#c8804a';
  for (let k = 0; k < 4; k++) { c.beginPath(); c.ellipse(x - r * .6 + k * r * .4, y - r * .6, r * .22, r * .18, 0, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.ellipse(x - r * .3, y - r * .7, r * .5, r * .2, 0, 0, Math.PI * 2); c.fill();
}

// ═══════════════════════════════════════════════
//  BACKGROUNDS
// ═══════════════════════════════════════════════
const BGT = { dojo: { sky: ['#0e0804', '#1a1008', '#180c04'], fl: ['#1a1204', '#0e0a02'], glow: 'rgba(220,140,40,', crd: '#0c0803' }, alley: { sky: ['#040408', '#080614', '#060412'], fl: ['#0c0c18', '#060610'], glow: 'rgba(80,100,255,', crd: '#040410' }, rooftop: { sky: ['#020208', '#04061a', '#06040e'], fl: ['#0a0a1a', '#050510'], glow: 'rgba(120,0,255,', crd: '#040408' }, pit: { sky: ['#00020c', '#000310', '#04020a'], fl: ['#180600', '#0c0300'], glow: 'rgba(255,80,0,', crd: '#040200' }, carnival: { sky: ['#080008', '#100010', '#0a0008'], fl: ['#180018', '#0c000c'], glow: 'rgba(255,0,100,', crd: '#060006' }, slums: { sky: ['#0c0400', '#160800', '#100400'], fl: ['#1a0800', '#0e0400'], glow: 'rgba(255,100,0,', crd: '#050200' }, tundra: { sky: ['#04060e', '#060a18', '#040810'], fl: ['#0a0e1a', '#060810'], glow: 'rgba(100,150,255,', crd: '#040608' }, swamp: { sky: ['#040a04', '#061408', '#040c04'], fl: ['#081408', '#040a04'], glow: 'rgba(0,200,50,', crd: '#030603' }, temple: { sky: ['#020a02', '#041604', '#051205'], fl: ['#081808', '#040c04'], glow: 'rgba(0,255,100,', crd: '#030603' }, demongate: { sky: ['#0a0004', '#140008', '#0c0006'], fl: ['#1a0012', '#0e000a'], glow: 'rgba(255,0,60,', crd: '#060003' }, hellcanyon: { sky: ['#100200', '#1a0400', '#140200'], fl: ['#220400', '#160200'], glow: 'rgba(255,50,0,', crd: '#060100' }, colosseum: { sky: ['#080204', '#100406', '#0c0204'], fl: ['#180408', '#0c0204'], glow: 'rgba(255,80,30,', crd: '#040102' }, shadowforest: { sky: ['#020208', '#030318', '#020210'], fl: ['#040420', '#020210'], glow: 'rgba(100,100,255,', crd: '#010108' }, lavafort: { sky: ['#0c0200', '#180400', '#120200'], fl: ['#280600', '#180400'], glow: 'rgba(255,100,0,', crd: '#060100' }, void: { sky: ['#000000', '#040008', '#020004'], fl: ['#080010', '#040008'], glow: 'rgba(200,200,255,', crd: '#020004' }, ruins: { sky: ['#020210', '#040420', '#030318'], fl: ['#060630', '#030318'], glow: 'rgba(0,255,200,', crd: '#010108' }, abyss: { sky: ['#000004', '#000008', '#000006'], fl: ['#020014', '#01000c'], glow: 'rgba(255,0,180,', crd: '#010002' }, storm: { sky: ['#020610', '#040c20', '#020818'], fl: ['#060c28', '#030816'], glow: 'rgba(200,200,0,', crd: '#020408' }, chaos: { sky: ['#060006', '#100010', '#080008'], fl: ['#140014', '#0a000a'], glow: 'rgba(255,50,255,', crd: '#040004' }, boss: { sky: ['#040004', '#080008', '#060006'], fl: ['#100014', '#08000c'], glow: 'rgba(255,0,255,', crd: '#030003' } };
function drawBG(theme) {
  const W = CV.width, H = CV.height, gY = H * .72, now = Date.now(); const t = BGT[theme] || BGT.alley;
  const sky = CX.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, t.sky[0]); sky.addColorStop(.55, t.sky[1]); sky.addColorStop(1, t.sky[2]); CX.fillStyle = sky; CX.fillRect(0, 0, W, H);
  if (['boss', 'chaos', 'void', 'abyss'].includes(theme)) { CX.save();[.75, .55, .38].forEach((r, i) => { CX.globalAlpha = .05 + i * .025 + Math.sin(now * .002 + i) * .02; CX.strokeStyle = t.glow + '1)'; CX.lineWidth = 2; CX.beginPath(); CX.arc(W * .5, H * .38, W * r * .5, 0, Math.PI * 2); CX.stroke(); }); CX.restore(); if (Math.random() < .04) { CX.save(); CX.globalAlpha = .32; CX.strokeStyle = t.glow + '1)'; CX.lineWidth = 2; CX.beginPath(); let lx = W * .5, ly = 0; for (let i = 0; i < 10; i++) { lx += (Math.random() - .5) * 90; ly += H * .072; CX.lineTo(lx, ly); } CX.stroke(); CX.restore(); } }
  if (['pit', 'lavafort', 'hellcanyon'].includes(theme)) { const lv = CX.createLinearGradient(0, H * .6, 0, H); lv.addColorStop(0, 'rgba(255,60,0,0)'); lv.addColorStop(.4, 'rgba(255,40,0,.17)'); lv.addColorStop(1, 'rgba(255,20,0,.35)'); CX.fillStyle = lv; CX.fillRect(0, H * .6, W, H); if (Math.random() < .08) { CX.save(); CX.globalAlpha = .5 + Math.random() * .3; CX.fillStyle = 'rgba(255,150,0,.55)'; CX.beginPath(); CX.arc(W * (.1 + Math.random() * .8), H * .72, Math.random() * 18 + 4, 0, Math.PI * 2); CX.fill(); CX.restore(); } }
  if (theme === 'tundra') { CX.save(); CX.globalAlpha = .07; CX.fillStyle = '#aaccff'; for (let i = 0; i < 6; i++) { CX.fillRect(Math.random() * W, Math.random() * H * .7, Math.random() * 180 + 40, 1); } CX.restore(); }
  if (theme === 'storm') { if (Math.random() < .06) { CX.save(); CX.globalAlpha = .4; CX.strokeStyle = '#ffff88'; CX.lineWidth = 3; CX.beginPath(); let lx2 = W * (.3 + Math.random() * .4), ly2 = 0; for (let i = 0; i < 7; i++) { lx2 += (Math.random() - .5) * 65; ly2 += H * .1; CX.lineTo(lx2, ly2); } CX.stroke(); CX.restore(); } }
  CX.save(); CX.globalAlpha = .45; for (let i = 0; i < 80; i++) { const sx = Math.sin(i * 73.1) * W * .49 + W * .5, sy = Math.cos(i * 47.3) * H * .27 + H * .09; CX.fillStyle = `rgba(255,255,255,${.18 + Math.sin(i) * .22})`; CX.beginPath(); CX.arc(sx, sy, .5, 0, Math.PI * 2); CX.fill(); } CX.restore();
  CX.fillStyle = t.sky[0]; CX.beginPath(); CX.moveTo(0, gY); for (let i = 0; i <= W; i += W / 20) { CX.lineTo(i, gY - (24 + Math.sin(i * .011) * 44 + Math.cos(i * .007) * 28)); } CX.lineTo(W, gY); CX.closePath(); CX.fill();
  CX.fillStyle = t.crd; for (let i = 0; i < 30; i++) { const bx = i / 30 * W, bw = W / 30 * .88, bh = 14 + Math.sin(i * 2.2) * 21 + Math.cos(i * .9) * 13; CX.fillRect(bx, gY - bh, bw, bh); }
  const fl = CX.createLinearGradient(0, gY, 0, H); fl.addColorStop(0, t.fl[0]); fl.addColorStop(1, t.fl[1]); CX.fillStyle = fl; CX.fillRect(0, gY, W, H);
  const flg = CX.createLinearGradient(0, 0, W, 0); flg.addColorStop(0, 'transparent'); flg.addColorStop(.5, t.glow + '0.55)'); flg.addColorStop(1, 'transparent'); CX.strokeStyle = flg; CX.lineWidth = 2.5; CX.beginPath(); CX.moveTo(0, gY); CX.lineTo(W, gY); CX.stroke();
  CX.save(); CX.globalAlpha = .055; for (let i = 0; i < 8; i++) { const fy = gY + (i / 8) * H * .28; CX.strokeStyle = t.glow + '1)'; CX.lineWidth = .8; CX.beginPath(); CX.moveTo(0, fy); CX.lineTo(W, fy); CX.stroke(); const vx = W * (i / 8 - .5) * .34; CX.beginPath(); CX.moveTo(W * .5, gY); CX.lineTo(W * .5 + vx * 4, H); CX.stroke(); } CX.restore();
  sptl(W * .22, gY, 120, t.glow); sptl(W * .78, gY, 120, 'rgba(255,255,255,'); sptl(W * .5, gY, 80, t.glow);
  CX.save(); CX.fillStyle = t.crd; CX.fillRect(0, H * .33, W, H * .06); CX.globalAlpha = .35; for (let i = 0; i < 65; i++) { const hx = Math.sin(i * 137.5) * W * .47 + W * .5, hy = H * .29 + Math.cos(i * 77.1) * H * .07, hr = 2 + Math.random() * 3; CX.fillStyle = '#040210'; CX.beginPath(); CX.arc(hx, hy, hr, 0, Math.PI * 2); CX.fill(); CX.fillRect(hx - hr * .5, hy, hr, hr * 2); if (i % 7 === 0) { CX.globalAlpha = .1; CX.fillStyle = `hsl(${i * 50},80%,70%)`; CX.beginPath(); CX.arc(hx, hy - 2, 2, 0, Math.PI * 2); CX.fill(); CX.globalAlpha = .35; } } CX.restore();
}
function sptl(x, gY, r, cb) { const cone = CX.createLinearGradient(x, gY * .28, x, gY); cone.addColorStop(0, cb + '0)'); cone.addColorStop(1, cb + '0.1)'); CX.save(); CX.globalAlpha = .6; CX.fillStyle = cone; CX.beginPath(); CX.moveTo(x - 6, gY * .28); CX.lineTo(x + 6, gY * .28); CX.lineTo(x + r * .52, gY); CX.lineTo(x - r * .52, gY); CX.closePath(); CX.fill(); const pool = CX.createRadialGradient(x, gY, 0, x, gY, r); pool.addColorStop(0, cb + '0.2)'); pool.addColorStop(1, cb + '0)'); CX.fillStyle = pool; CX.beginPath(); CX.ellipse(x, gY, r, r * .33, 0, 0, Math.PI * 2); CX.fill(); CX.restore(); }

// ═══════════════════════════════════════════════
//  GAME ENGINE
// ═══════════════════════════════════════════════
let lastT = 0;
function loop(ts = 0) {
  RAF = requestAnimationFrame(loop);
  const dt = Math.min((ts - lastT) / 16.67, 3); lastT = ts;
  applyShake(dt); tickPX(dt);
  CX.save(); CX.translate(SK.x, SK.y);
  const W = CV.width, H = CV.height, gY = H * .72;
  drawBG(G.lv ? G.lv.bg : 'boss');
  if (!document.getElementById('pg-home').classList.contains('hidden') && curTab === 'lb') {
    drawPodium(dt);
  } else if (G.p1 && G.lv) {
    // Update bobbing for idle states
    if (G.p1.state === 'idle' || G.p1.state === 'block') { G.p1.bob += G.p1.bdir * .35 * dt; if (Math.abs(G.p1.bob) > 4) G.p1.bdir *= -1; }
    if (G.p2.state === 'idle' || G.p2.state === 'block') { G.p2.bob += G.p2.bdir * .4 * dt; if (Math.abs(G.p2.bob) > 5) G.p2.bdir *= -1; }
    // Update positions via frame-rate independent exp decay
    const smoothF = 1 - Math.pow(0.86, dt || 1);
    G.p1.x += (G.p1.targetX - G.p1.x) * smoothF;
    G.p2.x += (G.p2.targetX - G.p2.x) * smoothF;
    // Update death animation
    if (G.p1.state === 'dead') { G.p1.deathProgress = Math.min((G.p1.deathProgress || 0) + dt * .025, 1); }
    if (G.p2.state === 'dead') { G.p2.deathProgress = Math.min((G.p2.deathProgress || 0) + dt * .025, 1); }
    // Clamp positions
    const minX = W * .3, maxX = W * .7;
    G.p1.x = Math.max(minX, Math.min(G.p1.x, maxX - 60));
    G.p2.x = Math.max(minX + 60, Math.min(G.p2.x, maxX));
    drawFighter(G.p1.x, gY, false, { ...G.p1, deathProgress: G.p1.deathProgress || 0 }, G.fd, 1.0);
    drawFighter(G.p2.x, gY, true, { ...G.p2, deathProgress: G.p2.deathProgress || 0 }, G.ed, G.ed.sz || 1.0);
  }
  drawPX(); drawFLT(dt); drawImp(dt); CX.restore();
}

function drawPodium(dt) {
  const W = CV.width, H = CV.height, gY = H * .72;
  const lb = window.cachedLB || [];
  if (lb.length === 0) return;
  const sc = Math.min(W / 800, 1.2);
  const pos = [
    { x: W * .5, y: gY, sc: 1.4 * sc, i: 0, c: '#ffd700', r: 1 },
    { x: W * .28, y: gY + 30 * sc, sc: 1.1 * sc, i: 1, c: '#c0c0c0', r: 2 },
    { x: W * .72, y: gY + 45 * sc, sc: 1.0 * sc, i: 2, c: '#cd7f32', r: 3 }
  ];
  const now = Date.now();
  pos.forEach(p => {
    const pl = lb[p.i]; if (!pl) return;
    const ch = CHARS.find(c => c.name === pl.char) || CHARS[0];
    CX.save(); CX.globalAlpha = .7 + Math.sin(now * .003 + p.i) * .15;
    const rg = CX.createRadialGradient(p.x, p.y, 0, p.x, p.y, 65 * p.sc);
    rg.addColorStop(0, p.c + '99'); rg.addColorStop(1, 'transparent');
    CX.fillStyle = rg; CX.beginPath(); CX.ellipse(p.x, p.y, 75 * p.sc, 22 * p.sc, 0, 0, Math.PI * 2); CX.fill();
    CX.globalAlpha = .35; CX.fillStyle = p.c; CX.font = `900 ${110 * p.sc}px 'Bebas Neue',sans-serif`;
    CX.textAlign = 'center'; CX.textBaseline = 'bottom'; CX.fillText(p.r, p.x, p.y - Math.max(100, 120 * p.sc)); CX.restore();
    drawFighter(p.x, p.y, p.i === 2 || (p.i === 1 && p.x > W * .5), { bob: Math.sin(now * .002 + p.i) * 3, state: 'idle' }, ch, p.sc);
  });
}

function buildDots(cur) { const d = document.getElementById('ldots'); d.innerHTML = LEVELS.map((l, i) => { let cls = 'ld'; if (l.e.boss) cls += ' bdot'; if (i + 1 < cur) cls += ' done'; else if (i + 1 === cur) cls += ' cur'; return `<div class="${cls}"></div>`; }).join(''); }
function lvlAnn(l1, l2, col) { const el = document.getElementById('lvlann'); document.getElementById('lat1').textContent = l1; document.getElementById('lat1').style.color = col; document.getElementById('lat1').style.textShadow = `0 0 38px ${col},0 0 76px ${col}44`; document.getElementById('lat2').textContent = l2; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
function updateHUD() {
  const pp = Math.max(0, G.pHp / G.pMax * 100), ep = Math.max(0, G.eHp / G.eMax * 100);
  document.getElementById('fhb1').style.width = pp + '%'; document.getElementById('fhb2').style.width = ep + '%';
  document.getElementById('fhh1').textContent = `${Math.max(0, G.pHp)}/${G.pMax}`; document.getElementById('fhh2').textContent = `${Math.max(0, G.eHp)}/${G.eMax}`;
  document.getElementById('fhsc').textContent = totalSc + G.score;
  document.getElementById('fhbw1').classList.toggle('shk', G.pHp < G.pMax * .3); document.getElementById('fhbw2').classList.toggle('shk', G.eHp < G.eMax * .3);
  document.getElementById('fhb1').classList.toggle('low', G.pHp < G.pMax * .3); document.getElementById('fhb2').classList.toggle('low', G.eHp < G.eMax * .3);
  document.getElementById('rf1').style.width = (G.rage || 0) + '%'; document.getElementById('rf2').style.width = (G.eRage || 0) + '%';
}

async function loadLevel(n, fresh) {
  const lv = LEVELS[n - 1], fd = CHARS[selChar], ed = lv.e;
  const pHp = fresh ? fd.hp : Math.min((G.pHp || fd.hp) + (lv.bon || 0), fd.hp);
  const W = CV.width, gY = CV.height * .72;
  let spBonus = 0, hlBonus = 0, dmgMul = 1, rageMul = 1, comboMul = 1.22;
  if (fresh && playerData) {
    let inv = mergeShopInv(playerData.shopInv);
    let used = false;
    if (inv.extraSp > 0) { inv.extraSp--; spBonus = 1; used = true; }
    if (inv.extraHeal > 0) { inv.extraHeal--; hlBonus = 1; used = true; }
    if (inv.dmgBoost > 0) { inv.dmgBoost--; dmgMul = 1.12; used = true; }
    if (inv.rageAmp > 0) { inv.rageAmp--; rageMul = 1.28; used = true; }
    if (inv.comboElixir > 0) { inv.comboElixir--; comboMul = 1.32; used = true; }
    if (used) {
      await savePlayer(playerName, { shopInv: inv });
      playerData = await loadPlayer(playerName) || playerData;
    }
  }
  const spTot = 3 + spBonus, hlTot = 2 + hlBonus;
  G = {
    running: true, selChar, fd, ed, lv, pHp, pMax: fd.hp, eHp: ed.hp, eMax: ed.hp,
    spUses: spTot, hlUses: hlTot, spMax: spTot, hlMax: hlTot, combo: 0, score: 0, turn: 0, busy: false, time: lv.time, cd: {}, rage: 0, eRage: 0, blocking: false,
    dmgMul, rageMul, comboMul,
    p1: { x: W * .42, targetX: W * .42, bob: 0, bdir: 1, state: 'idle', raging: false, deathProgress: 0 },
    p2: { x: W * .58, targetX: W * .58, bob: 0, bdir: -1, state: 'idle', raging: false, deathProgress: 0 },
  };
  ['fovl-win', 'fovl-lose', 'fovl-gc'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('fhn1').textContent = `${fd.ico} ${playerName}`;
  document.getElementById('fhn2').textContent = ed.nm; document.getElementById('fhn2').style.color = ed.eye; document.getElementById('fhn2').style.textShadow = `0 0 12px ${ed.eye}`;
  document.getElementById('fhlv').textContent = n; document.getElementById('fhstage').textContent = lv.nm; document.getElementById('fhsc').textContent = totalSc;
  const te = document.getElementById('fhtimer'); te.textContent = lv.time; te.classList.remove('dan');
  const dm = G.dmgMul;
  document.getElementById('pdmg').textContent = `${Math.floor(fd.pR[0] * dm)}–${Math.ceil(fd.pR[1] * dm)}`;
  document.getElementById('kdmg').textContent = `${Math.floor(fd.kR[0] * dm)}–${Math.ceil(fd.kR[1] * dm)}`;
  document.getElementById('sdmg').textContent = `${Math.floor(fd.sR[0] * dm)}–${Math.ceil(fd.sR[1] * dm)}`;
  document.getElementById('suse').textContent = '✦'.repeat(spTot) + ` ${spTot}`;
  document.getElementById('huse').textContent = '♥'.repeat(hlTot) + ` ${hlTot}`;
  ['punch', 'kick', 'special', 'heal', 'back', 'fwd'].forEach(t => {
    setDis('btn-' + t, false);
    const cb = document.getElementById('cb-' + t);
    if (cb) { cb.style.transition = 'none'; cb.style.width = '0%'; }
  });
  setDis('btn-block', false);
  buildDots(n); updateHUD();
  clearInterval(TID);
  TID = setInterval(() => { if (!G.running) return; G.time--; const te2 = document.getElementById('fhtimer'); te2.textContent = G.time; if (G.time <= 10) { te2.classList.add('dan'); sfxTick(); } if (G.time <= 0) { clearInterval(TID); timeOut(); } }, 1000);
  if (ed.boss) { sfxBoss(); lvlAnn('BOSS FIGHT!', ed.nm, ed.eye); speakAnnouncer('Boss Fight!'); } else { lvlAnn(`LEVEL ${n}`, lv.nm, '#ffd700'); speakAnnouncer('Fight!'); }
  if (ed.taunts?.length) setTimeout(() => showTaunt(ed.nm, ed.taunts[Math.floor(Math.random() * ed.taunts.length)], ed.eye), 1800);
  if (Math.random() < .35) setTimeout(async () => { const t = await aiTaunt(ed.nm, `fight start level ${n}`, G.pHp, G.eHp); if (t && G.running) showTaunt(ed.nm, t, ed.eye); }, 4000);
}

// ── BLOCK HOLD ──
let blockHeld = false;
let blockStartTime = 0;
function holdBlock(on) {
  blockHeld = on;
  if (on && G.running && !G.busy) { blockStartTime = Date.now(); G.blocking = true; G.p1.state = 'block'; G.combo = 0; }
  else if (!on && G.blocking) { G.blocking = false; if (G.p1.state === 'block') setPose('p1', 'idle'); }
}

function setPose(who, state, duration = 400) {
  G[who].state = state;
  if (duration && state !== 'idle' && state !== 'dead') {
    setTimeout(() => { if (G[who] && G[who].state === state && state !== 'dead') G[who].state = 'idle'; }, duration);
  }
}

// ── COMBAT ACTIONS ──
async function act(type) {
  if (!G.running || G.busy || G.cd[type]) return;
  if (type === 'special' && G.spUses <= 0) return;
  if (type === 'heal' && G.hlUses <= 0) return;
  if (type === 'block') { holdBlock(true); setTimeout(() => holdBlock(false), 800); return; }
  G.busy = true; G.turn++; disableBtns(true);

  const fd = G.fd, W = CV.width, H = CV.height;
  const eX = G.p2.x, eY = H * .44, pX = G.p1.x, pY = H * .44;
  let dmg = 0;
  const rMul = G.rageMul || 1;
  const cMul = G.comboMul || 1.22;
  const dMul = G.dmgMul || 1;
  const rB = G.rage >= 100 ? 1.4 : 1.0;
  if (G.rage >= 100) { G.rage = 0; sfxRage(); showAnn('RAGE MODE!', '#ff4500'); G.p1.raging = true; setTimeout(() => { if (G.p1) G.p1.raging = false; }, 1500); }

  if (type === 'fwd') {
    G.p1.targetX = Math.min(G.p1.x + 45, G.p2.x - 90);
    G.p1.state = 'walk_fwd'; sfxStep();
    setTimeout(() => { if (G.p1 && G.p1.state === 'walk_fwd') G.p1.state = 'idle'; }, 350);
    setCooldown('fwd', 500); G.busy = false; disableBtns(false); return;
  }
  if (type === 'back') {
    G.p1.targetX = Math.max(G.p1.x - 45, CV.width * .14);
    G.p1.state = 'walk_back'; sfxStep();
    setTimeout(() => { if (G.p1 && G.p1.state === 'walk_back') G.p1.state = 'idle'; }, 350);
    setCooldown('back', 400); G.busy = false; disableBtns(false); return;
  }

  if (type === 'punch') {
    dmg = Math.floor(rng(fd.pR[0], fd.pR[1]) * rB * dMul);
    const crit = Math.random() < .15;
    if (crit) { dmg = Math.floor(dmg * 1.7); showAnn('CRITICAL!', '#ff8800'); sfxCrit(); if (Math.random() < 0.5) speakAnnouncer('Critical!'); } else sfxPunch();
    G.combo++; if (G.combo >= 3) { dmg = Math.floor(dmg * cMul); showCombo(G.combo); } G.rage = Math.min(100, G.rage + Math.floor(12 * rMul));
    // Lunge forward then snap back
    const homeX = G.p1.targetX;
    G.p1.targetX = Math.min(G.p1.x + 32, G.p2.x - 78);
    setPose('p1', 'punch', 280);
    await wait(120);
    G.p1.targetX = homeX;
    doShake(crit ? 17 : 9); doImpact(crit ? .24 : .11); sfxHit();
    htmlFlash(crit ? 'rgba(255,140,0,.2)' : 'rgba(255,255,255,.07)'); setPose('p2', 'hurt', 220);
    spart(eX, eY, crit ? '#ff6600' : '#ffaa44', crit ? 34 : 18, 'spark');
    if (crit) spart(eX, eY, '#cc2200', 10, 'blood');
    sflt(eX, eY - 44, `-${dmg}`, crit ? '#ff4400' : '#ffcc00');
    if (crit && G.running) setTimeout(async () => { const t = await aiTaunt(G.ed.nm, 'just got critically hit', G.pHp, G.eHp); if (t && G.running) showTaunt(G.ed.nm, t, G.ed.eye); }, 600);
  } else if (type === 'kick') {
    dmg = Math.floor(rng(fd.kR[0], fd.kR[1]) * rB * dMul);
    const crit = Math.random() < .12;
    if (crit) { dmg = Math.floor(dmg * 1.8); showAnn('SUPER KICK!', '#ff1100'); sfxCrit(); if (Math.random() < 0.5) speakAnnouncer('Super hit!'); } else sfxKick();
    G.combo++; if (G.combo >= 3) { dmg = Math.floor(dmg * cMul); showCombo(G.combo); } G.rage = Math.min(100, G.rage + Math.floor(16 * rMul));
    const homeX = G.p1.targetX;
    G.p1.targetX = Math.min(G.p1.x + 36, G.p2.x - 78);
    setPose('p1', 'kick', 350);
    await wait(190);
    G.p1.targetX = homeX;
    doShake(crit ? 22 : 13); doImpact(crit ? .3 : .15); sfxHit();
    htmlFlash(crit ? 'rgba(255,40,0,.24)' : 'rgba(255,80,80,.09)'); setPose('p2', 'hurt', 260);
    spart(eX, eY, crit ? '#ff1100' : '#ff6644', crit ? 40 : 22, 'spark');
    spart(eX, eY, '#880000', crit ? 14 : 6, 'blood');
    sflt(eX, eY - 54, `-${dmg}`, crit ? '#ff0000' : '#ff6644');
  } else if (type === 'special') {
    dmg = Math.floor(rng(fd.sR[0], fd.sR[1]) * rB * dMul); G.spUses--; G.combo++; G.rage = Math.min(100, G.rage + Math.floor(25 * rMul));
    sfxSpecial(); setPose('p1', 'special', 500); showAnn('SPECIAL ATTACK!!', '#cc44ff'); doShake(30); doImpact(.42); htmlFlash('rgba(150,0,255,.32)');
    spart(W * .5, H * .54, '#cc44ff', 60, 'spark'); spart(eX, eY, '#880088', 22, 'blood'); spart(pX, pY, '#ff00ff', 22, 'spark'); sflt(eX, eY - 66, `-${dmg}!!`, '#dd44ff'); showCombo(G.combo);
    await wait(340); sfxHit(); setPose('p2', 'hurt', 300);
    document.getElementById('suse').textContent = '✦'.repeat(G.spUses) + '░'.repeat(G.spMax - G.spUses) + ` ${G.spUses}`;
  } else if (type === 'heal') {
    const h = rng(20, 35); G.hlUses--; G.combo = 0; sfxHeal(); G.pHp = Math.min(G.pHp + h, G.pMax); showAnn('HEALED!', '#00e676');
    spart(pX, pY, '#00e676', 30, 'spark'); sflt(pX, pY - 54, `+${h} HP`, '#00e676'); htmlFlash('rgba(0,230,120,.1)');
    document.getElementById('huse').textContent = '♥'.repeat(G.hlUses) + '░'.repeat(G.hlMax - G.hlUses) + ` ${G.hlUses}`;
    updateHUD(); setCooldown('heal', 2600); G.busy = false; disableBtns(false); return;
  }

  if (dmg > 0) { G.score += dmg; G.eHp = Math.max(0, G.eHp - dmg); }
  updateHUD(); setCooldown(type, type === 'special' ? 2400 : type === 'kick' ? 1150 : 920);
  await wait(60);
  if (G.eHp <= 0) { await wait(200); await showDeath('enemy'); await wait(600); levelWin(); return; }
  if (G.eHp < G.eMax * .3 && Math.random() < .3 && G.running) setTimeout(async () => { const t = await aiTaunt(G.ed.nm, 'low HP', G.pHp, G.eHp); if (t && G.running) showTaunt(G.ed.nm, t, G.ed.eye); }, 200);
  await wait(420); await enemyTurn();
  if (G.running && G.pHp > 0 && G.eHp > 0) { G.busy = false; disableBtns(false); }
}

async function enemyTurn() {
  if (!G.running) return;
  const W = CV.width, H = CV.height, ed = G.ed, pX = G.p1.x, pY = H * .44;
  G.eRage = Math.min(100, G.eRage + 8); const eB = G.eRage >= 100 ? 1.35 : 1.0;
  if (G.eRage >= 100) { G.eRage = 0; G.p2.raging = true; setTimeout(() => { if (G.p2) G.p2.raging = false; }, 1500); }
  updateHUD();

  // Enemy moves closer occasionally
  if (Math.random() < .25) {
    const dir = G.p2.x > G.p1.x ? -1 : 1;
    G.p2.targetX = G.p2.x + dir * 40;
    G.p2.state = 'walk_fwd'; await wait(300); G.p2.state = 'idle';
  }

  if (Math.random() < ed.miss) { showAnn('DODGED!', '#00d4ff'); sfxDodge(); G.combo = 0; return; }

  const roll = rng(1, 10); let dmg, type;
  if (roll <= 4) { dmg = rng(ed.pR[0], ed.pR[1]); type = 'punch'; } else if (roll <= 7) { dmg = rng(ed.kR[0], ed.kR[1]); type = 'kick'; } else { dmg = rng(ed.sR[0], ed.sR[1]); type = 'special'; }
  dmg = Math.floor(dmg * eB);

  setPose('p2', type === 'kick' ? 'kick' : type === 'special' ? 'special' : 'attack', 400);
  if (type === 'special') { htmlFlash('rgba(100,0,200,.15)'); doShake(14); }
  await wait(180); if (!G.running) return;

  // Check if player is blocking
  if (G.blocking) {
    const heldMs = Date.now() - blockStartTime;
    const perfect = heldMs >= 40 && heldMs <= 300;
    sfxBlock(); const reduced = Math.floor(dmg * 0.4); showAnn(perfect ? 'PERFECT BLOCK!' : 'BLOCKED!', perfect ? '#00d4ff' : '#ffd700'); doShake(perfect ? 8 : 5);
    spart(pX, pY, '#ffd700', 12, 'spark'); sflt(pX, pY - 44, `-${reduced}`, '#ffd700');
    G.pHp = Math.max(0, G.pHp - reduced); G.combo = 0;
    if (perfect) {
      const cb = rng(10, 18);
      G.eHp = Math.max(0, G.eHp - cb);
      G.score += cb;
      G.rage = Math.min(100, (G.rage || 0) + Math.floor(14 * (G.rageMul || 1)));
      spart(G.p2.x, H * .44, '#00d4ff', 16, 'spark');
      sflt(G.p2.x, H * .44 - 48, `-${cb}`, '#66ddff');
      sfxCounter();
    }
    updateHUD();
    if (G.eHp <= 0) { await wait(160); await showDeath('enemy'); await wait(600); levelWin(); return; }
    if (G.pHp <= 0) { await wait(200); await showDeath('player'); await wait(600); levelLose(); return; }
    G.busy = false; disableBtns(false); return;
  }

  setPose('p1', 'hurt', 300); sfxHit();
  doShake(type === 'special' ? 24 : type === 'kick' ? 16 : 10); doImpact(type === 'special' ? .28 : type === 'kick' ? .16 : .09);
  htmlFlash(type === 'special' ? 'rgba(120,0,200,.2)' : 'rgba(60,80,255,.09)');
  spart(pX, pY, ed.eye || '#2266ff', type === 'special' ? 36 : 18, 'spark'); if (type !== 'punch') spart(pX, pY, '#330055', 8, 'blood'); sflt(pX, pY - 54, `-${dmg}`, ed.eye || '#44aaff');
  G.combo = 0; G.pHp = Math.max(0, G.pHp - dmg); updateHUD();
  await wait(65); if (!G.running) return;
  if (G.pHp <= 0) { await wait(200); await showDeath('player'); await wait(600); levelLose(); return; }
  G.busy = false; disableBtns(false);
}

// Death animation — plays collapse animation before showing overlay
async function showDeath(who) {
  const target = who === 'player' ? G.p1 : G.p2;
  if (!target) return;
  sfxDeath();
  speakAnnouncer(who === 'player' ? 'You lose!' : 'K O!');
  if (who === 'enemy') {
    doShake(45); doImpact(0.8); htmlFlash('rgba(255,200,0,0.4)');
    showAnn('K. O.!', '#ff0000');
  }
  target.state = 'dead';
  target.deathProgress = 0;
  // Spawn impact particles
  const dx = who === 'player' ? G.p1.x : G.p2.x;
  spart(dx, CV.height * .65, '#cc0000', 40, 'blood');
  spart(dx, CV.height * .55, '#888888', 22, 'spark');
  // Animate collapse
  return new Promise(res => {
    let prog = 0;
    const iv = setInterval(() => {
      prog += (who === 'enemy') ? 0.012 : 0.032; // Finisher slow motion for enemy death!
      if (who === 'enemy') { doShake(5); } // constant epic rumble
      target.deathProgress = Math.min(prog, 1);
      if (prog >= 1) { clearInterval(iv); res(); }
    }, 16);
  });
}

function timeOut() { if (!G.running) return; G.pHp >= G.eHp ? levelWin() : levelLose(); }

async function shareGame(e) {
  if (e) e.stopPropagation();
  sfxSel();
  let text = `Play SHADOW STRIKER X, an epic arcade fighting game!`;
  if (window.levelData && window.levelData.maxLevel > 1) {
    text = `I reached Level ${levelData.maxLevel} in SHADOW STRIKER X! Can you beat my score?`;
  }
  const url = 'https://mjagriti110-bot.github.io/Shadow-Striker-X/';
  if (navigator.share) { try { await navigator.share({ title: 'Shadow Striker X', text, url }); } catch (err) { } }
  else { try { await navigator.clipboard.writeText(text + " " + url); showAnn("LINK COPIED!", "#00d4ff"); } catch (err) { } }
}

const INFO_TXT = {
  about: `<h2>About Us</h2><p>SHADOW STRIKER X is an ultimate arcade fighting gauntlet created by mjagriti110.</p><p>We specialize in creating thrilling web-based gaming experiences that push the boundaries of HTML5 Canvas and modern browser capabilities.</p><p>Keep fighting and conquering the leaderboard!</p>`,
  contact: `<h2>Contact Us</h2><p>Have questions, feedback, or need support?</p><p>Email: <b>am7135077@gmail.com</b></p><p>Follow us on social media for updates, leaderboards, and upcoming tournaments!</p>`,
  privacy: `<h2>Privacy Policy</h2><p>Your privacy is important to us. SHADOW STRIKER X is completely contained entirely within your browser.</p><ul><li><b>Local Storage:</b> Game progress, high scores, and unlocked characters are stored locally on your device via <code>localStorage</code>.</li><li><b>Data Collection:</b> We do not collect, share, or sell any of your personal data.</li><li><b>Accounts:</b> No accounts are required. Play completely anonymously.</li></ul>`,
  terms: `<h2>Terms and Conditions</h2><p>By playing SHADOW STRIKER X, you agree to these terms:</p><ol><li><b>Use:</b> The game and all its assets are provided "as-is" without any warranties.</li><li><b>Restrictions:</b> You may not reverse-engineer, distribute, or modify the core game engine for commercial purposes without explicit permission.</li><li><b>Liability:</b> We are not liable for any data loss regarding your save progress.</li></ol><p>Have fun and keep striking!</p>`
};

function showInfo(e, type) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  sfxSel();
  const ov = document.getElementById('fovl-info');
  const title = document.getElementById('info-title');
  const body = document.getElementById('info-body');

  const titles = {
    about: 'ABOUT US',
    contact: 'CONTACT US',
    privacy: 'PRIVACY POLICY',
    terms: 'TERMS & CONDITIONS'
  };

  title.textContent = titles[type] || 'INFORMATION';
  body.innerHTML = INFO_TXT[type];
  ov.classList.remove('hidden');
}

function closeInfo(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  sfxNav();
  document.getElementById('fovl-info').classList.add('hidden');
}

async function levelWin() {
  G.running = false; clearInterval(TID); disableBtns(true); totalSc += G.score; sfxWin();
  const stars = G.pHp > G.pMax * .66 ? 3 : G.pHp > G.pMax * .33 ? 2 : 1;
  const W = CV.width, H = CV.height;
  for (let i = 0; i < 6; i++)setTimeout(() => { spart(W * (.15 + Math.random() * .7), H * .5, '#ffd700', 28, 'spark'); spart(W * (.15 + Math.random() * .7), H * .5, '#ff8800', 14, 'spark'); }, i * 110);
  const ch = CHARS[selChar];
  const newMax = Math.max(G.lv.n, playerData?.maxLevel || 0);
  const winPts = 38 + Math.floor(G.lv.n * 2);
  const winCoins = 3 + Math.floor(G.lv.n / 5);
  const nextBank = (playerData?.bankPts || 0) + winPts;
  const nextCoin = (playerData?.coins || 0) + winCoins;
  await savePlayer(playerName, { charId: selChar, charName: ch.name, maxLevel: newMax, highScore: Math.max(totalSc, playerData?.highScore || 0), totalScore: totalSc, totalWins: (playerData?.totalWins || 0) + 1, bankPts: nextBank, coins: nextCoin });
  await saveLevelResult(playerName, G.lv.n, { score: G.score, stars, turns: G.turn });
  playerData = await loadPlayer(playerName); levelData = await loadLevelData(playerName);
  curLv = Math.min(G.lv.n + 1, MAX_LEVELS);
  await saveProgress(playerName, { curLv, totalSc, selChar, lastLevelPlayed: G.lv.n });
  await rebuildLeaderboard();
  if (G.lv.n === MAX_LEVELS) { setTimeout(() => showGC(), 900); return; }
  sfxUnlock();
  const nxt = LEVELS[G.lv.n];
  document.getElementById('fw-sub').textContent = `ROUND: ${G.score} · TOTAL: ${totalSc}`;
  document.getElementById('fw-stars').innerHTML = Array.from({ length: 3 }, (_, i) => `<span class="fstar">${i < stars ? '⭐' : '☆'}</span>`).join('');
  const bon = nxt.bon || 0; const bp = document.getElementById('fw-bonus');
  bp.textContent = bon > 0 ? `+${bon} HP on next fight` : 'NO BONUS HP'; bp.style.cssText = bon > 0 ? 'color:#00e676;background:rgba(0,230,120,.1);border-color:rgba(0,230,120,.3);' : 'color:#ff8800;background:rgba(255,140,0,.08);border-color:rgba(255,140,0,.25);';
  const diff = nxt.n >= 15 ? 'EXTREME' : nxt.n >= 10 ? 'BRUTAL' : nxt.n >= 5 ? 'HARD' : 'MEDIUM';
  document.getElementById('fw-next').innerHTML =
    `<div style="background:rgba(255,215,0,.07);border:1px solid rgba(255,215,0,.18);border-radius:5px;padding:6px 12px;margin-bottom:9px;text-align:center;"><span style="font-family:'Orbitron',monospace;font-size:.5rem;color:var(--gold);letter-spacing:.16em;">🔓 LEVEL ${nxt.n} UNLOCKED!</span></div>
    <span class="fnlbl">NEXT OPPONENT</span><span class="fnico">${nxt.e.ico}</span><span class="fnnm" style="color:${nxt.e.eye}">${nxt.e.nm}</span>
    <div class="fndesc">${nxt.e.taunts?.[0] || ''}</div>
    <div class="fnsts">HP:<b>${nxt.e.hp}</b> · Stage:<b>${nxt.nm}</b> · <b style="color:${diff === 'EXTREME' ? '#ff0044' : diff === 'BRUTAL' ? '#ff4400' : diff === 'HARD' ? '#ff8800' : '#44ff44'}">${diff}</b></div>`;
  aiTaunt(nxt.e.nm, 'about to face new challenger', 100, nxt.e.hp).then(t => { if (t) document.getElementById('fw-next').innerHTML += `<div class="aiq"><em>"${t}"</em></div>`; });
  setTimeout(() => document.getElementById('fovl-win').classList.remove('hidden'), 500);
}

async function levelLose() {
  G.running = false; clearInterval(TID); disableBtns(true); sfxLose();
  await savePlayer(playerName, { charId: selChar, maxLevel: Math.max(G.lv.n - 1, playerData?.maxLevel || 0), highScore: Math.max(totalSc, playerData?.highScore || 0), totalScore: totalSc });
  await saveProgress(playerName, { curLv: G.lv.n, totalSc, selChar, lastLevelPlayed: G.lv.n });
  playerData = await loadPlayer(playerName);
  const gr = G.score > 200 ? 'B' : G.score > 100 ? 'C' : 'D';
  document.getElementById('fl-body').innerHTML = `Level: <b>${G.lv.n} — ${G.lv.nm}</b><br>Damage: <b>${G.score}</b> · Turns: <b>${G.turn}</b><br>Grade: <b style="color:#ff8800">${gr}</b>`;
  setTimeout(() => document.getElementById('fovl-lose').classList.remove('hidden'), 800);
}

async function showGC() {
  sfxGameClear(); const ch = CHARS[selChar];
  const gr = totalSc > 3000 ? 'S' : totalSc > 2000 ? 'A' : totalSc > 1200 ? 'B' : 'C';
  document.getElementById('fgc-sc').textContent = `TOTAL SCORE: ${totalSc}`;
  document.getElementById('fgc-gr').textContent = gr; document.getElementById('fgc-gr').style.color = gr === 'S' ? '#ffd700' : gr === 'A' ? '#ff8800' : gr === 'B' ? '#44aaff' : '#888';
  document.getElementById('fgc-stars').innerHTML = '⭐'.repeat(gr === 'S' ? 5 : gr === 'A' ? 4 : gr === 'B' ? 3 : 2);
  document.getElementById('fgc-quote').innerHTML = '<span class="ail"><span class="ald"></span><span class="ald"></span><span class="ald"></span> GENERATING LEGEND...</span>';
  await savePlayer(playerName, { charId: selChar, charName: ch.name, maxLevel: MAX_LEVELS, highScore: Math.max(totalSc, playerData?.highScore || 0), totalScore: totalSc, champion: true });
  await rebuildLeaderboard();
  playerData = await loadPlayer(playerName); levelData = await loadLevelData(playerName);
  aiVictory(playerName, ch.name, totalSc).then(msg => { const q = document.getElementById('fgc-quote'); if (q) q.textContent = `"${msg}"`; });
  const W = CV.width, H = CV.height; for (let i = 0; i < 40; i++)setTimeout(() => spart(Math.random() * W, H * .5, '#ffd700', 18, 'spark'), i * 70);
  setTimeout(() => document.getElementById('fovl-gc').classList.remove('hidden'), 900);
}

async function nextLevel() { sfxNav(); document.getElementById('fovl-win').classList.add('hidden'); hideFightUI(); curLv = G.lv.n + 1; await saveProgress(playerName, { curLv, totalSc, selChar, lastLevelPlayed: curLv }); renderCharSelect(curLv); goTo('pg-char'); }
function retryLevel() { sfxNav(); document.getElementById('fovl-lose').classList.add('hidden'); hideFightUI(); curLv = G.lv.n; renderCharSelect(curLv); goTo('pg-char'); }
async function goHomeFromFight() {
  sfxNav(); G.running = false; clearInterval(TID); PX = []; FLT = [];
  ['fovl-win', 'fovl-lose', 'fovl-gc'].forEach(id => document.getElementById(id).classList.add('hidden'));
  hideFightUI(); totalSc = 0;
  await saveProgress(playerName, { curLv, totalSc, selChar, lastLevelPlayed: curLv });
  playerData = await loadPlayer(playerName) || basePlayer();
  levelData = await loadLevelData(playerName); selChar = playerData.charId || 0;
  await renderHome(); goTo('pg-home');
}

// HELPERS
function setDis(id, v) { const el = document.getElementById(id); if (el) { if (v) el.setAttribute('disabled', ''); else el.removeAttribute('disabled'); } }
function disableBtns(dis) {
  ['punch', 'kick', 'special', 'heal', 'back', 'fwd', 'block'].forEach(t => {
    if (!dis) {
      if (t === 'special' && G.spUses <= 0) setDis('btn-' + t, true);
      else if (t === 'heal' && G.hlUses <= 0) setDis('btn-' + t, true);
      else setDis('btn-' + t, !!G.cd[t]);
    } else {
      setDis('btn-' + t, true);
    }
  });
}
function setCooldown(type, ms) {
  if (type === 'special' && G.spUses <= 0) { setDis('btn-special', true); return; }
  if (type === 'heal' && G.hlUses <= 0) { setDis('btn-heal', true); return; }
  G.cd[type] = true;
  const bar = document.getElementById('cb-' + type);
  if (bar) {
    bar.style.transition = 'none'; bar.style.width = '100%';
    setTimeout(() => {
      bar.style.transition = `width ${ms}ms linear`; bar.style.width = '0%';
      setTimeout(() => { G.cd[type] = false; }, ms);
    }, 30);
  } else {
    setTimeout(() => { G.cd[type] = false; }, ms);
  }
}
function htmlFlash(col) { const f = document.getElementById('flash'); f.style.background = col; f.style.opacity = '1'; setTimeout(() => f.style.opacity = '0', 110); }
function showAnn(text, col) { const el = document.getElementById('ann'); el.textContent = text; el.style.color = col; el.style.textShadow = `0 0 26px ${col}`; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
function showCombo(n) { if (n < 2) return; if (n === 3) speakAnnouncer('Combo!'); if (n === 6) speakAnnouncer('Awesome Combo!'); const el = document.getElementById('cpop'); el.textContent = `${n}× COMBO!`; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }

// Keyboard controls
const keysDown = {};
document.addEventListener('keydown', e => {
  if (keysDown[e.key]) return; keysDown[e.key] = true;
  if (!G.running) return;
  const m = { 'q': 'punch', 'w': 'kick', 'e': 'special', 'r': 'heal', '1': 'punch', '2': 'kick', '3': 'special', '4': 'heal' };
  const mv = { 'a': 'back', 'arrowleft': 'back', 'd': 'fwd', 'arrowright': 'fwd' };
  const k = e.key.toLowerCase();
  if (m[k] && !G.busy) act(m[k]);
  else if (mv[k] && !G.busy) act(mv[k]);
  else if ((k === 's' || k === 'arrowdown') && !G.busy) holdBlock(true);
});
document.addEventListener('keyup', e => {
  keysDown[e.key] = false;
  const k = e.key.toLowerCase();
  if (k === 's' || k === 'arrowdown') holdBlock(false);
});
document.getElementById('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

// Mobile touch controls: immediate response and no accidental page gestures.
function bindTouchCombatControls() {
  const acts = [['btn-punch', 'punch'], ['btn-kick', 'kick'], ['btn-special', 'special'], ['btn-heal', 'heal'], ['btn-back', 'back'], ['btn-fwd', 'fwd']];
  acts.forEach(([id, action]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', e => { e.preventDefault(); if (G.running && !G.busy) act(action); }, { passive: false });
  });
  const ctrl = document.getElementById('fctrl');
  if (ctrl) {
    ['touchstart', 'touchmove', 'touchend'].forEach(evt => {
      ctrl.addEventListener(evt, e => e.preventDefault(), { passive: false });
    });
  }
}

// BOOT
goTo('pg-splash');
initLogin();
loop();
bindTouchCombatControls();
['click', 'touchstart', 'keydown'].forEach(evt => document.addEventListener(evt, () => startBGM(), { once: true, passive: true }));
