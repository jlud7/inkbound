import React, { useEffect, useRef, useState } from 'react';

// ============================================================================
// INKBOUND — a creature-binder / grid-battler.
//
// Architecture summary (see project brief for full spec):
//  - Finite state machine: phase in {OVERWORLD, TRANSITION, BATTLE, RESULT}.
//  - ONE requestAnimationFrame loop drives all timing (cooldowns, projectile
//    motion, AI timers, telegraphs, i-frames). No gameplay setInterval.
//  - Hot mutable state lives in a single ref ("G" = gameRef.current"). React
//    state is only a frame counter bumped once per rAF frame to trigger
//    renders; all render code reads fresh values straight out of G.
//  - Keyboard input writes into G.input (a "held" set for movement-hold and
//    a one-shot "pressed" buffer for taps); handlers never touch game state.
// ============================================================================

// ----------------------------------------------------------------------------
// CFG — every tunable number in the game lives here.
// ----------------------------------------------------------------------------
const CFG = {
  // Overworld
  MAP_COLS: 24,
  MAP_ROWS: 16,
  TILE_SIZE: 32,
  STEP_MS: 140, // ms per overworld tile-step while a direction is held
  STEP_ANIM_MS: 100, // CSS glide duration for the avatar transform
  ENCOUNTER_CHANCE: 0.15, // per margin-tile step
  PITY_STEPS: 10, // guaranteed encounter on the Nth consecutive margin step
  BLOCKING_GLYPHS: '#TUWt', // wall/hedge, tree, fountain, well, statue — single walkability source
  AREA_NAME: 'The Cloister Garden',

  // Transition
  TRANSITION_MS: 1200,

  // Battle grid
  BCOLS: 6,
  BROWS: 3,
  BTILE: 64,
  FRAME_PAD: 44, // parchment/page-frame margin ring around the battle grid (px)

  // Player abilities (shared across familiars; per-familiar move cooldown
  // and bolt stats live in FAMILIARS below — Quill's values are the base
  // 120ms / 8dmg / 1.0s / 8 tiles-per-second numbers from the design).
  SLASH_DMG: 20,
  SLASH_CD: 3.5,
  SLASH_FLASH_MS: 150,
  BIND_HP_THRESHOLD: 0.30, // enemy hp ratio at/below which Bind is usable
  BIND_MIN_CHANCE: 0.40, // success chance right at the 30% threshold
  BIND_MAX_CHANCE: 0.90, // success chance as enemy hp approaches 1
  BIND_FAIL_CD: 4.0,
  BIND_RILE_FACTOR: 0.75, // fire-interval multiplier applied after a failed bind

  IFRAME_MS: 600, // player invulnerability after being hit
  HIT_FLASH_MS: 250, // enemy hit-flash duration

  SWAP_CD_MS: 1000,
  SWAP_IFRAME_MS: 500,

  PARTY_MAX: 6,
  TOTAL_SPECIES: 4, // Drollery, Grotesque, Basilisk, Snail-Knight

  RESULT_MS: 2000,

  COLORS: {
    parchment: '#E8DCC4',
    ink: '#2B2620',
    vermilion: '#C1440E',
    gold: '#C9A227',
    indigo: '#34405E',
    grass: '#C6C79E', // soft sage-parchment green wash for `'` terrain
  },

  // Battle-feel effect tunables (all driven by the rAF loop except pure-CSS bob)
  FX: {
    DMG_NUM_MS: 600, // floating damage-number lifetime
    DMG_NUM_RISE_PX: 24, // how far a damage number floats up over its lifetime
    DMG_NUM_MAX: 20, // hard cap on live damage numbers (oldest dropped first)
    SHAKE_MS: 150, // screen-shake duration when the player takes damage
    SHAKE_MAX_PX: 4, // max shake displacement (decays linearly to 0)
    BOB_S: 1.6, // idle-bob period (pure cosmetic CSS keyframes)
    BOB_PX: 3, // idle-bob amplitude
    BIND_STAMP_IN_MS: 200, // seal-stamp scale-in
    BIND_STAMP_CRACK_MS: 250, // seal-stamp crack-apart on a failed bind
    BIND_FAIL_FLASH_MS: 300, // vermilion flash on the enemy after a failed bind
    ENTITY_SCALE: 1.15, // battle entities render at 115% of the tile
  },

  // WebAudio blip definitions. type: oscillator type; freqs: note sequence in
  // Hz (or [from, to] when slide); dur: seconds (per note, or total for a
  // slide); gain: peak gain (kept <= 0.15 everywhere). All clips < ~180ms.
  SFX: {
    step: { type: 'square', freqs: [220], dur: 0.002, gain: 0.025 },
    bolt: { type: 'square', freqs: [440, 880], dur: 0.07, gain: 0.07, slide: true },
    slash: { type: 'triangle', freqs: [950, 180], dur: 0.09, gain: 0.1, slide: true },
    playerHit: { type: 'square', freqs: [130, 65], dur: 0.13, gain: 0.12, slide: true },
    enemyHit: { type: 'square', freqs: [520], dur: 0.055, gain: 0.08 },
    telegraph: { type: 'triangle', freqs: [330], dur: 0.12, gain: 0.06 },
    bindTry: { type: 'triangle', freqs: [392, 523], dur: 0.08, gain: 0.1 },
    bindSuccess: { type: 'triangle', freqs: [523, 659, 784], dur: 0.06, gain: 0.12 },
    victory: { type: 'triangle', freqs: [523, 659, 784, 1047], dur: 0.045, gain: 0.12 },
    defeat: { type: 'triangle', freqs: [392, 311], dur: 0.09, gain: 0.12 },
    encounter: { type: 'square', freqs: [349, 466], dur: 0.08, gain: 0.1 },
  },

  // Player-side familiar stats. Slash/Bind are shared and unaffected by species.
  FAMILIARS: {
    Quill: { hp: 100, boltDmg: 8, boltCd: 1.0, boltSpeed: 8, moveCdMs: 120, color: '#34405E' },
    Drollery: { hp: 80, boltDmg: 6, boltCd: 0.7, boltSpeed: 8, moveCdMs: 90, color: '#8A6D3B' },
    Grotesque: { hp: 130, boltDmg: 10, boltCd: 1.4, boltSpeed: 8, moveCdMs: 120, color: '#5B6B3E' },
    Basilisk: { hp: 60, boltDmg: 13, boltCd: 1.0, boltSpeed: 12, moveCdMs: 120, color: '#6B3E63' },
    'Snail-Knight': { hp: 110, boltDmg: 9, boltCd: 1.2, boltSpeed: 8, moveCdMs: 150, color: '#D8D0C0' },
  },

  // Wild enemy roster (encounter table). Weights must sum to 1.
  ENEMIES: {
    Drollery: { hp: 40, weight: 0.55, moveIntervalMs: 1200, fireMin: 2.0, fireMax: 3.0, boltSpeed: 6, boltDmg: 6 },
    Grotesque: { hp: 60, weight: 0.25, moveIntervalMs: 1800, telegraphMs: 500, swipeDmg: 15, swipeCdS: 2.5 },
    Basilisk: { hp: 30, weight: 0.15, moveIntervalMs: 1000, fireMin: 2.5, fireMax: 3.5, boltSpeed: 10, boltDmg: 12, telegraphMs: 400 },
    'Snail-Knight': {
      hp: 50,
      weight: 0.05,
      moveIntervalMs: 2200,
      exposedMs: 2000, // shell cycle: this long exposed...
      shelledMs: 1500, // ...then this long withdrawn into the shell
      shellDmgFactor: 0.25, // incoming damage multiplier while shelled
      telegraphMs: 600, // lance-charge row telegraph
      lanceDmg: 14,
      lanceCdS: 3.0, // riled applies BIND_RILE_FACTOR to this
    },
  },
};

// ----------------------------------------------------------------------------
// Overworld map — "The Cloister Garden", 24x16. An open garden, not a maze.
// Legend: # wall/hedge (blocking), . path (tan), ' grass (walkable),
// , unfinished margin (encounter), S spawn, + shrine (heal),
// T tree (blocking), U fountain (blocking), W well (blocking),
// t statue (blocking), f flowers (walkable decor).
// Blocking set = CFG.BLOCKING_GLYPHS ('#TUWt'); everything else is walkable.
//
// Zone sketch:
//   NW corner ......... margin patch A (6 tiles) over the lawn
//   N-center .......... path spine running down from the north hedge
//   NE corner ......... orchard: 2x3 grid of trees with grass aisles
//   W side ............ shrine #1 (x6,y5) with flower bed, well (x4,y7)
//                       beside the spawn path
//   Center ............ fountain plaza: broad path apron (x10..14,y6..9)
//                       around the fountain (x12,y7) + statue (x13,y7) pair
//   Row 8 ............. the main east-west promenade, border to border
//   E side ............ shrine #2 (x18,y10) with flower bed
//   SW corner ......... margin patch C (6 tiles)
//   SE corner ......... margin patch B (6 tiles)
//
// Reachability hand-verified by BFS during authoring (see audit): all 299
// non-blocking tiles are reachable from S at (2,8) — the promenade touches
// every zone, and no decor placement seals off a region.
// ----------------------------------------------------------------------------
const MAP = [
  '########################',
  "#,,,''''''''.''''T'T'T'#",
  "#,,,''''''''.''''''''''#",
  "#'''''''''''.''''T'T'T'#",
  "#'''''''''''.''''''''''#",
  "#'''''+f''''.''''''''''#",
  "#'''''.f''.....''''''''#",
  "#'.fW'.'''..Ut.''''''''#",
  '#.Sf...................#',
  "#'''''''''.....''f.''''#",
  "#'''''''''''.''''f+''''#",
  "#'''''''''''.''''''''''#",
  "#'''''''''''.''''''''''#",
  "#,,,''''''''.'''''',,,'#",
  "#,,,''''''''.'''''',,,'#",
  '########################',
];

// The one walkability test — every collision check goes through this.
const isBlockedGlyph = (ch) => CFG.BLOCKING_GLYPHS.includes(ch);

const SPAWN = (() => {
  for (let y = 0; y < MAP.length; y++) {
    const x = MAP[y].indexOf('S');
    if (x !== -1) return { x, y };
  }
  return { x: 1, y: 1 };
})();

const OUTER_WIDTH = CFG.MAP_COLS * CFG.TILE_SIZE + 40;

// Battle entities render slightly larger than their tile (Task: presence).
const ENT_SIZE = Math.round(CFG.BTILE * CFG.FX.ENTITY_SCALE);
const ENT_OFF = Math.round((CFG.BTILE - ENT_SIZE) / 2);

// ----------------------------------------------------------------------------
// Small pure helpers
// ----------------------------------------------------------------------------
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const rand = (min, max) => min + Math.random() * (max - min);

const DIR_VECTORS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

function pickSpecies() {
  const table = Object.entries(CFG.ENEMIES).map(([name, e]) => [name, e.weight]);
  let r = Math.random();
  for (const [name, w] of table) {
    if (r < w) return name;
    r -= w;
  }
  return table[table.length - 1][0];
}

function actionFromKey(e) {
  switch (e.key) {
    case 'ArrowUp': case 'w': case 'W': return 'up';
    case 'ArrowDown': case 's': case 'S': return 'down';
    case 'ArrowLeft': case 'a': case 'A': return 'left';
    case 'ArrowRight': case 'd': case 'D': return 'right';
    case 'z': case 'Z': return 'z';
    case 'x': case 'X': return 'x';
    case 'c': case 'C': return 'c';
    case 'm': case 'M': return 'mute';
    case 'Tab': return 'tab';
    default: return null;
  }
}

// ----------------------------------------------------------------------------
// Sound — a tiny WebAudio synth. The AudioContext is created lazily inside the
// click-to-begin handler (a user gesture) via initAudio(); if creation fails,
// sfx() is a permanent no-op. Audio NEVER drives gameplay timing: every call
// is fire-and-forget from game-logic sites in the rAF loop's call tree.
// Mute state lives in G.muted (HUD reads it); sfxSetMuted mirrors it here so
// the module-level sfx() doesn't need the game ref threaded through.
// ----------------------------------------------------------------------------
let sfxCtx = null;
let sfxFailed = false;
let sfxMuted = false;

function initAudio() {
  if (sfxCtx || sfxFailed) {
    // Some browsers hand back a suspended context; a later gesture may resume it.
    if (sfxCtx && sfxCtx.state === 'suspended') sfxCtx.resume().catch(() => {});
    return;
  }
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { sfxFailed = true; return; }
    sfxCtx = new Ctor();
  } catch {
    sfxFailed = true;
    sfxCtx = null;
  }
}

function sfxSetMuted(muted) {
  sfxMuted = muted;
}

function sfx(name) {
  if (!sfxCtx || sfxMuted) return;
  const def = CFG.SFX[name];
  if (!def) return;
  try {
    const t0 = sfxCtx.currentTime + 0.001;
    if (def.slide) {
      // One oscillator sweeping freqs[0] -> freqs[1] over dur.
      const osc = sfxCtx.createOscillator();
      const g = sfxCtx.createGain();
      osc.type = def.type;
      osc.frequency.setValueAtTime(def.freqs[0], t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, def.freqs[1]), t0 + def.dur);
      g.gain.setValueAtTime(def.gain, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + def.dur);
      osc.connect(g).connect(sfxCtx.destination);
      osc.start(t0);
      osc.stop(t0 + def.dur + 0.02);
    } else {
      // Sequential notes, each dur long with a quick decay envelope.
      def.freqs.forEach((freq, i) => {
        const nt = t0 + i * def.dur;
        const osc = sfxCtx.createOscillator();
        const g = sfxCtx.createGain();
        osc.type = def.type;
        osc.frequency.setValueAtTime(freq, nt);
        g.gain.setValueAtTime(def.gain, nt);
        g.gain.exponentialRampToValueAtTime(0.001, nt + def.dur);
        osc.connect(g).connect(sfxCtx.destination);
        osc.start(nt);
        osc.stop(nt + def.dur + 0.02);
      });
    }
  } catch {
    // Never let audio problems touch gameplay.
  }
}

// ----------------------------------------------------------------------------
// Game state factory. Everything hot/mutable for the whole session lives in
// this object, held in a single useRef in the component (never in React state).
// ----------------------------------------------------------------------------
function makeInitialGame() {
  return {
    phase: 'OVERWORLD',
    input: { held: new Set(), pressed: new Set() },
    overworld: {
      playerX: SPAWN.x,
      playerY: SPAWN.y,
      facing: 'down',
      stepTimerMs: CFG.STEP_MS, // "ready" so the first press steps immediately
      marginStreak: 0, // pity counter — consecutive margin steps w/o encounter
      shrineFlashTimer: 0,
      returnX: SPAWN.x,
      returnY: SPAWN.y,
    },
    party: [{ species: 'Quill', hp: CFG.FAMILIARS.Quill.hp, maxHp: CFG.FAMILIARS.Quill.hp }],
    bestiary: new Set(), // unique species successfully bound
    muted: false, // sfx mute toggle (M key); mirrored into the sfx module
    battle: null,
    transitionStage: null, // 'flash1' | 'off1' | 'flash2' | 'wipe'
    timeouts: [], // pending setTimeout ids (TRANSITION/RESULT sequencing only)
  };
}

function scheduleTimeout(G, fn, delay) {
  const id = setTimeout(fn, delay);
  G.timeouts.push(id);
  return id;
}

// ----------------------------------------------------------------------------
// Party helpers
// ----------------------------------------------------------------------------
function firstLivingIndex(party) {
  const idx = party.findIndex((p) => p.hp > 0);
  return idx === -1 ? 0 : idx;
}

function nextLivingIndex(party, fromIndex) {
  for (let i = 1; i <= party.length; i++) {
    const idx = (fromIndex + i) % party.length;
    if (party[idx].hp > 0) return idx;
  }
  return -1;
}

// ----------------------------------------------------------------------------
// Projectiles
// ----------------------------------------------------------------------------
let projectileIdCounter = 0;

function spawnProjectile(G, owner, col, row, speed, dmg) {
  G.battle.projectiles.push({ id: ++projectileIdCounter, owner, x: col, row, speed, dmg });
}

// Advance every projectile by dt, then drop anything off-grid. Filtering here
// every frame is what keeps the array from ever growing unbounded.
function moveProjectiles(G, dt) {
  const B = G.battle;
  for (const p of B.projectiles) {
    p.x += (p.owner === 'player' ? 1 : -1) * p.speed * dt;
  }
  B.projectiles = B.projectiles.filter((p) => p.x >= -1 && p.x <= CFG.BCOLS + 1);
}

// Collision: round each projectile's continuous x to a tile column and check
// it against the relevant valid target (enemy for player shots, active
// familiar for enemy shots, gated by i-frames). Hit projectiles are dropped.
function resolveCollisions(G) {
  const B = G.battle;
  const remaining = [];
  for (const p of B.projectiles) {
    const tileCol = Math.round(p.x);
    let hit = false;
    if (p.owner === 'player') {
      if (B.enemy.hp > 0 && tileCol === B.enemy.col && p.row === B.enemy.row) {
        applyDamageToEnemy(G, p.dmg);
        hit = true;
      }
    } else {
      if (B.iframeTimer <= 0 && tileCol === B.playerCol && p.row === B.playerRow) {
        applyDamageToPlayer(G, p.dmg);
        hit = true;
      }
    }
    if (!hit) remaining.push(p);
  }
  B.projectiles = remaining;
}

// Floating damage numbers — short-lived effect records ticked/pruned every
// frame in stepBattleEffects. Hard-capped so the array can never grow unbounded.
let dmgNumIdCounter = 0;

function pushDamageNumber(G, col, row, amount, kind) {
  const B = G.battle;
  B.damageNumbers.push({ id: ++dmgNumIdCounter, col, row, amount: Math.round(amount), kind, t: 0 });
  while (B.damageNumbers.length > CFG.FX.DMG_NUM_MAX) B.damageNumbers.shift();
}

function applyDamageToEnemy(G, dmg) {
  const B = G.battle;
  // Snail-Knight in its shell only takes a fraction of any incoming damage.
  if (B.enemySpecies === 'Snail-Knight' && B.enemy.shelled) {
    dmg *= CFG.ENEMIES['Snail-Knight'].shellDmgFactor;
  }
  B.enemy.hp = Math.max(0, B.enemy.hp - dmg);
  B.enemy.hitFlashTimer = CFG.HIT_FLASH_MS / 1000;
  pushDamageNumber(G, B.enemy.col, B.enemy.row, dmg, 'dealt');
  sfx('enemyHit');
}

function applyDamageToPlayer(G, dmg) {
  const B = G.battle;
  if (B.iframeTimer > 0) return; // i-frames block every damage source, incl. Grotesque swipes
  const active = G.party[B.activeIndex];
  if (active.hp <= 0) return; // already down, no double-dipping
  active.hp = Math.max(0, active.hp - dmg);
  B.iframeTimer = CFG.IFRAME_MS / 1000;
  pushDamageNumber(G, B.playerCol, B.playerRow, dmg, 'taken');
  B.shakeTimer = CFG.FX.SHAKE_MS / 1000; // screen shake on player damage only
  sfx('playerHit');
  if (active.hp <= 0) {
    // Auto-swap to the next living member (if any); defeat is decided by
    // checkBattleEnd once ALL party members are down.
    const nextIdx = nextLivingIndex(G.party, B.activeIndex);
    if (nextIdx !== -1) {
      B.activeIndex = nextIdx;
      B.iframeTimer = Math.max(B.iframeTimer, CFG.SWAP_IFRAME_MS / 1000);
    }
  }
}

function doSwap(G) {
  const B = G.battle;
  if (B.swapCdTimer > 0) return;
  const idx = nextLivingIndex(G.party, B.activeIndex);
  if (idx === -1 || idx === B.activeIndex) return; // no other living member to swap to
  B.activeIndex = idx;
  B.swapCdTimer = CFG.SWAP_CD_MS / 1000;
  B.iframeTimer = Math.max(B.iframeTimer, CFG.SWAP_IFRAME_MS / 1000);
  // grid position (playerCol/playerRow) intentionally untouched — swap keeps position
}

function attemptBind(G) {
  const B = G.battle;
  const enemy = B.enemy;
  const hpRatio = enemy.hp / enemy.maxHp;
  if (hpRatio > CFG.BIND_HP_THRESHOLD || B.bindCdTimer > 0) return;

  // Chance scales linearly from BIND_MIN_CHANCE at the 30%-hp threshold to
  // BIND_MAX_CHANCE as hp approaches 1.
  const thresholdHp = CFG.BIND_HP_THRESHOLD * enemy.maxHp;
  const hp = Math.max(1, enemy.hp);
  const span = Math.max(1e-6, thresholdHp - 1);
  const t = clamp((thresholdHp - hp) / span, 0, 1);
  const chance = CFG.BIND_MIN_CHANCE + t * (CFG.BIND_MAX_CHANCE - CFG.BIND_MIN_CHANCE);

  sfx('bindTry');
  const success = Math.random() < chance;
  // Seal-stamp effect on the enemy tile: scales in over BIND_STAMP_IN_MS, then
  // holds until RESULT on success or cracks apart on failure. Ticked in
  // stepBattleEffects (which also runs during RESULT, so the scale-in
  // completes even though gameplay freezes the instant a bind succeeds).
  B.bindStamp = { t: 0, state: 'in', success };

  if (success) {
    G.bestiary.add(B.enemySpecies);
    let partyFull = false;
    if (G.party.length < CFG.PARTY_MAX) {
      const stats = CFG.FAMILIARS[B.enemySpecies];
      G.party.push({ species: B.enemySpecies, hp: stats.hp, maxHp: stats.hp });
    } else {
      partyFull = true;
    }
    sfx('bindSuccess');
    enterResult(G, 'BOUND', { species: B.enemySpecies, partyFull });
  } else {
    // Riled: fire interval reduced 25%, Bind goes on cooldown.
    enemy.riled = true;
    enemy.bindFailFlashTimer = CFG.FX.BIND_FAIL_FLASH_MS / 1000; // vermilion flash
    B.bindCdTimer = CFG.BIND_FAIL_CD;
  }
}

// ----------------------------------------------------------------------------
// Enemy AI. Each function reads/writes G.battle.enemy in place. Called once
// per frame from stepBattle with the elapsed delta time (seconds).
// ----------------------------------------------------------------------------

// Drollery: wanders randomly around its 3x3 zone; fires only when aligned
// with the player's row, on a randomized 2-3s interval.
function stepDrollery(G, dt) {
  const B = G.battle;
  const enemy = B.enemy;
  const base = CFG.ENEMIES.Drollery;

  enemy.moveTimer += dt;
  if (enemy.moveTimer >= base.moveIntervalMs / 1000) {
    enemy.moveTimer = 0;
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const [dcol, drow] = dirs[Math.floor(Math.random() * dirs.length)];
    enemy.col = clamp(enemy.col + dcol, 3, 5);
    enemy.row = clamp(enemy.row + drow, 0, 2);
  }

  if (enemy.nextFireInterval == null) {
    enemy.nextFireInterval = rand(base.fireMin, base.fireMax) * (enemy.riled ? CFG.BIND_RILE_FACTOR : 1);
  }
  enemy.fireTimer += dt;
  if (enemy.fireTimer >= enemy.nextFireInterval) {
    enemy.fireTimer = 0;
    if (enemy.row === B.playerRow) {
      spawnProjectile(G, 'enemy', enemy.col - 1, enemy.row, base.boltSpeed, base.boltDmg);
    }
    enemy.nextFireInterval = rand(base.fireMin, base.fireMax) * (enemy.riled ? CFG.BIND_RILE_FACTOR : 1);
  }
}

// Grotesque: drifts toward its front column (3). Once there, telegraphs the
// adjacent player-side tile for 500ms, then swipes it for flat damage.
function stepGrotesque(G, dt) {
  const B = G.battle;
  const enemy = B.enemy;
  const base = CFG.ENEMIES.Grotesque;

  if (!enemy.telegraphActive) {
    enemy.moveTimer += dt;
    if (enemy.moveTimer >= base.moveIntervalMs / 1000) {
      enemy.moveTimer = 0;
      if (enemy.col > 3) {
        enemy.col -= 1;
      } else {
        const d = [-1, 0, 1][Math.floor(Math.random() * 3)];
        enemy.row = clamp(enemy.row + d, 0, 2);
      }
    }
  }

  enemy.swipeCdTimer = Math.max(0, enemy.swipeCdTimer - dt);
  if (!enemy.telegraphActive && enemy.col === 3 && enemy.swipeCdTimer <= 0) {
    enemy.telegraphActive = true;
    enemy.telegraphTimer = 0;
    sfx('telegraph');
  }

  if (enemy.telegraphActive) {
    enemy.telegraphTimer += dt;
    if (enemy.telegraphTimer >= base.telegraphMs / 1000) {
      enemy.telegraphActive = false;
      enemy.swipeCdTimer = base.swipeCdS * (enemy.riled ? CFG.BIND_RILE_FACTOR : 1);
      // Swipe lands on the single player-side tile across the seam, in-row.
      if (B.playerCol === 2 && B.playerRow === enemy.row) {
        applyDamageToPlayer(G, base.swipeDmg);
      }
    }
  }
}

// Basilisk: glass cannon that chases the player's row and fires a fast shot
// on a randomized 2.5-3.5s interval, preceded by a 400ms row-glow telegraph.
function stepBasilisk(G, dt) {
  const B = G.battle;
  const enemy = B.enemy;
  const base = CFG.ENEMIES.Basilisk;

  enemy.moveTimer += dt;
  if (enemy.moveTimer >= base.moveIntervalMs / 1000) {
    enemy.moveTimer = 0;
    if (enemy.row < B.playerRow) enemy.row++;
    else if (enemy.row > B.playerRow) enemy.row--;
  }

  if (enemy.nextFireInterval == null) {
    enemy.nextFireInterval = rand(base.fireMin, base.fireMax) * (enemy.riled ? CFG.BIND_RILE_FACTOR : 1);
  }
  enemy.fireTimer += dt;
  const telegraphStart = enemy.nextFireInterval - base.telegraphMs / 1000;
  if (!enemy.telegraphActive && enemy.fireTimer >= telegraphStart) {
    enemy.telegraphActive = true;
    sfx('telegraph');
  }
  if (enemy.fireTimer >= enemy.nextFireInterval) {
    spawnProjectile(G, 'enemy', enemy.col - 1, enemy.row, base.boltSpeed, base.boltDmg);
    enemy.fireTimer = 0;
    enemy.telegraphActive = false;
    enemy.nextFireInterval = rand(base.fireMin, base.fireMax) * (enemy.riled ? CFG.BIND_RILE_FACTOR : 1);
  }
}

// Snail-Knight: an armored siege unit on a shell cycle — exposedMs out of the
// shell, then shelledMs withdrawn (incoming damage x shellDmgFactor, rendered
// smaller/desaturated). While exposed it slowly chases the player's row, and
// when its lance is off cooldown it telegraphs the player-side half of its
// current row for telegraphMs, dashes to its front column (3), and strikes
// the two nearest player tiles in that row (cols 2 and 1) for lanceDmg —
// a single hit at most, gated by the usual i-frames. The shell cycle pauses
// during the lance so the charge always lands from the exposed state.
function stepSnailKnight(G, dt) {
  const B = G.battle;
  const enemy = B.enemy;
  const base = CFG.ENEMIES['Snail-Knight'];

  // --- shell cycle (paused mid-lance) ---
  if (!enemy.telegraphActive) {
    enemy.shellTimer += dt;
    if (!enemy.shelled && enemy.shellTimer >= base.exposedMs / 1000) {
      enemy.shelled = true;
      enemy.shellTimer = 0;
    } else if (enemy.shelled && enemy.shellTimer >= base.shelledMs / 1000) {
      enemy.shelled = false;
      enemy.shellTimer = 0;
    }
  }

  // --- ponderous movement: chase the player's row while exposed ---
  enemy.moveTimer += dt;
  if (enemy.moveTimer >= base.moveIntervalMs / 1000) {
    enemy.moveTimer = 0;
    if (!enemy.shelled && !enemy.telegraphActive) {
      if (enemy.row < B.playerRow) enemy.row++;
      else if (enemy.row > B.playerRow) enemy.row--;
      else enemy.col = clamp(enemy.col + [-1, 1][Math.floor(Math.random() * 2)], 3, 5);
    }
  }

  // --- lance charge: only initiates while exposed ---
  enemy.lanceCdTimer = Math.max(0, enemy.lanceCdTimer - dt);
  if (!enemy.telegraphActive && !enemy.shelled && enemy.lanceCdTimer <= 0) {
    enemy.telegraphActive = true;
    enemy.telegraphTimer = 0;
    enemy.lanceRow = enemy.row; // row locks when the telegraph begins
    sfx('telegraph');
  }

  if (enemy.telegraphActive) {
    enemy.telegraphTimer += dt;
    if (enemy.telegraphTimer >= base.telegraphMs / 1000) {
      enemy.telegraphActive = false;
      enemy.lanceCdTimer = base.lanceCdS * (enemy.riled ? CFG.BIND_RILE_FACTOR : 1);
      enemy.col = 3; // the dash to the front column
      enemy.row = enemy.lanceRow;
      // Strike the two nearest player tiles in the row: cols 2 and 1. One hit
      // max by construction (the player occupies a single tile), and
      // applyDamageToPlayer respects i-frames.
      if (B.playerRow === enemy.lanceRow && (B.playerCol === 2 || B.playerCol === 1)) {
        applyDamageToPlayer(G, base.lanceDmg);
      }
    }
  }
}

function checkBattleEnd(G) {
  const B = G.battle;
  if (!B || B.resultReason) return; // already concluded, awaiting the RESULT timeout
  if (B.enemy.hp <= 0) {
    enterResult(G, 'SUBDUED', {});
    return;
  }
  if (G.party.every((p) => p.hp <= 0)) {
    enterResult(G, 'DEFEAT', {});
  }
}

function enterResult(G, reason, extra) {
  G.battle.resultReason = reason;
  G.battle.resultExtra = extra;
  G.phase = 'RESULT';
  if (reason === 'SUBDUED') sfx('victory');
  else if (reason === 'DEFEAT') sfx('defeat');
  // BOUND already played bindSuccess at the attemptBind site.
  scheduleTimeout(G, () => finalizeResult(G), CFG.RESULT_MS);
}

function finalizeResult(G) {
  G.timeouts = [];
  // Testing convenience: fully heal the whole party after every battle.
  // This should become shrine-only once real progression is added.
  G.party.forEach((p) => { p.hp = p.maxHp; });
  G.overworld.marginStreak = 0; // reset the pity counter after each battle
  G.overworld.playerX = G.overworld.returnX;
  G.overworld.playerY = G.overworld.returnY;
  G.battle = null;
  G.phase = 'OVERWORLD';
}

// ----------------------------------------------------------------------------
// Overworld step logic
// ----------------------------------------------------------------------------
function healParty(G) {
  G.party.forEach((p) => { p.hp = p.maxHp; });
  G.overworld.shrineFlashTimer = 0.4;
}

function tryStep(G, dir) {
  const OW = G.overworld;
  const [dx, dy] = DIR_VECTORS[dir];
  OW.facing = dir;
  const nx = OW.playerX + dx;
  const ny = OW.playerY + dy;
  if (ny < 0 || ny >= CFG.MAP_ROWS || nx < 0 || nx >= CFG.MAP_COLS) return;
  const tile = MAP[ny][nx];
  if (isBlockedGlyph(tile)) return; // hedge, tree, fountain, well, statue
  OW.playerX = nx;
  OW.playerY = ny;
  sfx('step');
  if (tile === '+') healParty(G);
  else if (tile === ',') rollEncounter(G);
}

function rollEncounter(G) {
  const OW = G.overworld;
  OW.marginStreak += 1;
  const forced = OW.marginStreak >= CFG.PITY_STEPS;
  if (forced || Math.random() < CFG.ENCOUNTER_CHANCE) {
    startEncounter(G, pickSpecies());
  }
}

function startEncounter(G, species) {
  G.overworld.returnX = G.overworld.playerX;
  G.overworld.returnY = G.overworld.playerY;
  G.phase = 'TRANSITION';
  G.transitionStage = 'flash1';
  sfx('encounter');
  scheduleTimeout(G, () => { G.transitionStage = 'off1'; }, 90);
  scheduleTimeout(G, () => { G.transitionStage = 'flash2'; }, 170);
  scheduleTimeout(G, () => { G.transitionStage = 'wipe'; }, 260);
  scheduleTimeout(G, () => { startBattle(G, species); }, CFG.TRANSITION_MS);
}

function startBattle(G, species) {
  const base = CFG.ENEMIES[species];
  G.battle = {
    enemySpecies: species,
    enemy: {
      hp: base.hp,
      maxHp: base.hp,
      col: 4,
      row: 1,
      moveTimer: 0,
      fireTimer: 0,
      nextFireInterval: null,
      riled: false,
      telegraphActive: false,
      telegraphTimer: 0,
      swipeCdTimer: 0,
      hitFlashTimer: 0,
      // Snail-Knight shell/lance state (inert for other species)
      shelled: false,
      shellTimer: 0,
      lanceCdTimer: species === 'Snail-Knight' ? CFG.ENEMIES[species].lanceCdS : 0,
      lanceRow: 1,
      bindFailFlashTimer: 0,
    },
    activeIndex: firstLivingIndex(G.party),
    playerCol: 1,
    playerRow: 1,
    moveCdTimer: 0,
    boltCdTimer: 0,
    slashCdTimer: 0,
    bindCdTimer: 0,
    swapCdTimer: 0,
    iframeTimer: 0,
    slashFlashTimer: 0,
    slashFlashTiles: [],
    projectiles: [],
    // short-lived visual effect records — ticked & pruned in stepBattleEffects
    damageNumbers: [],
    shakeTimer: 0,
    shakeX: 0,
    shakeY: 0,
    bindStamp: null, // { t, state: 'in'|'hold'|'crack', success }
    resultReason: null,
    resultExtra: null,
  };
  G.phase = 'BATTLE';
}

function stepOverworld(G, dt) {
  const OW = G.overworld;
  OW.shrineFlashTimer = Math.max(0, OW.shrineFlashTimer - dt);
  OW.stepTimerMs += dt * 1000;

  const held = G.input.held;
  const pressed = G.input.pressed;
  // A direction counts as active if currently held OR tapped this frame: a
  // quick keydown+keyup landing between two rAF frames leaves `held` empty at
  // sample time, but the one-shot `pressed` buffer still carries it — without
  // this, discrete taps get dropped. `pressed` clears at end-of-frame, so a
  // tap yields exactly one step; hold-to-repeat cadence is unchanged.
  const dirDown = (d) => held.has(d) || pressed.has(d);
  let dir = null;
  if (dirDown('up')) dir = 'up';
  else if (dirDown('down')) dir = 'down';
  else if (dirDown('left')) dir = 'left';
  else if (dirDown('right')) dir = 'right';

  if (dir) {
    if (OW.stepTimerMs >= CFG.STEP_MS) {
      OW.stepTimerMs = 0;
      tryStep(G, dir);
    }
  } else {
    OW.stepTimerMs = CFG.STEP_MS; // stay "ready" so the next press steps instantly
  }
}

// ----------------------------------------------------------------------------
// Battle step logic — the per-frame heart of combat.
// ----------------------------------------------------------------------------
function stepBattle(G, dt) {
  const B = G.battle;
  if (!B || B.resultReason) return; // frozen while a RESULT overlay is pending

  // --- cooldown / timer ticks -------------------------------------------------
  B.moveCdTimer = Math.max(0, B.moveCdTimer - dt);
  B.boltCdTimer = Math.max(0, B.boltCdTimer - dt);
  B.slashCdTimer = Math.max(0, B.slashCdTimer - dt);
  B.bindCdTimer = Math.max(0, B.bindCdTimer - dt);
  B.swapCdTimer = Math.max(0, B.swapCdTimer - dt);
  B.iframeTimer = Math.max(0, B.iframeTimer - dt);
  B.slashFlashTimer = Math.max(0, B.slashFlashTimer - dt);
  // (hit-flash / shake / damage-number / bind-stamp timers tick in
  // stepBattleEffects, which also runs during RESULT so effects settle.)

  const held = G.input.held;
  const pressed = G.input.pressed;
  const activeStats = CFG.FAMILIARS[G.party[B.activeIndex].species];

  // --- player movement: instant tile snap, clamped to own 3x3, cooldown-gated
  if (B.moveCdTimer <= 0) {
    // held OR pressed: catches taps shorter than one frame (see stepOverworld).
    const dirDown = (d) => held.has(d) || pressed.has(d);
    let dir = null;
    if (dirDown('up')) dir = 'up';
    else if (dirDown('down')) dir = 'down';
    else if (dirDown('left')) dir = 'left';
    else if (dirDown('right')) dir = 'right';
    if (dir) {
      const [dx, dy] = DIR_VECTORS[dir];
      const nc = clamp(B.playerCol + dx, 0, 2); // player territory: cols 0-2
      const nr = clamp(B.playerRow + dy, 0, 2);
      if (nc !== B.playerCol || nr !== B.playerRow) {
        B.playerCol = nc;
        B.playerRow = nr;
        B.moveCdTimer = activeStats.moveCdMs / 1000;
      }
    }
  }

  // --- Z: Gilt Bolt ---
  if (pressed.has('z') && B.boltCdTimer <= 0) {
    spawnProjectile(G, 'player', B.playerCol + 1, B.playerRow, activeStats.boltSpeed, activeStats.boltDmg);
    B.boltCdTimer = activeStats.boltCd;
    sfx('bolt');
  }

  // --- X: Marginal Slash (1x3 vertical column at playerCol+1) ---
  if (pressed.has('x') && B.slashCdTimer <= 0) {
    const targetCol = B.playerCol + 1;
    const rows = [B.playerRow - 1, B.playerRow, B.playerRow + 1].filter((r) => r >= 0 && r <= 2);
    B.slashFlashTiles = rows.map((r) => ({ col: targetCol, row: r }));
    B.slashFlashTimer = CFG.SLASH_FLASH_MS / 1000;
    if (B.enemy.hp > 0 && targetCol === B.enemy.col && rows.includes(B.enemy.row)) {
      applyDamageToEnemy(G, CFG.SLASH_DMG);
    }
    B.slashCdTimer = CFG.SLASH_CD;
    sfx('slash');
  }

  // --- C: Bind (only once enemy hp <= 30%) ---
  const bindable = B.enemy.hp / B.enemy.maxHp <= CFG.BIND_HP_THRESHOLD;
  if (pressed.has('c') && bindable && B.bindCdTimer <= 0) {
    attemptBind(G);
  }

  // --- Tab: swap active familiar ---
  if (pressed.has('tab')) {
    doSwap(G);
  }

  // --- projectile motion (must run even the frame the enemy dies) ---
  moveProjectiles(G, dt);

  // --- enemy AI dispatch ---
  if (B.enemy.hp > 0) {
    if (B.enemySpecies === 'Drollery') stepDrollery(G, dt);
    else if (B.enemySpecies === 'Grotesque') stepGrotesque(G, dt);
    else if (B.enemySpecies === 'Basilisk') stepBasilisk(G, dt);
    else if (B.enemySpecies === 'Snail-Knight') stepSnailKnight(G, dt);
  }

  // --- collisions, then check for battle-ending conditions ---
  resolveCollisions(G);
  checkBattleEnd(G);
}

// ----------------------------------------------------------------------------
// Battle-feel effect ticker. Runs every frame while a battle object exists —
// during BATTLE *and* RESULT (gameplay freezes at RESULT but effects like the
// bind stamp's scale-in and a lingering shake should still settle). Every
// array here is pruned each frame, so nothing grows unbounded.
// ----------------------------------------------------------------------------
function stepBattleEffects(G, dt) {
  const B = G.battle;
  if (!B) return;

  // floating damage numbers: age, then prune expired
  for (const d of B.damageNumbers) d.t += dt;
  B.damageNumbers = B.damageNumbers.filter((d) => d.t < CFG.FX.DMG_NUM_MS / 1000);

  // enemy flash timers
  B.enemy.hitFlashTimer = Math.max(0, B.enemy.hitFlashTimer - dt);
  B.enemy.bindFailFlashTimer = Math.max(0, B.enemy.bindFailFlashTimer - dt);

  // screen shake: random offset each frame, magnitude decaying to zero
  if (B.shakeTimer > 0) {
    B.shakeTimer = Math.max(0, B.shakeTimer - dt);
    const mag = CFG.FX.SHAKE_MAX_PX * (B.shakeTimer / (CFG.FX.SHAKE_MS / 1000));
    B.shakeX = rand(-mag, mag);
    B.shakeY = rand(-mag, mag);
  } else {
    B.shakeX = 0;
    B.shakeY = 0;
  }

  // bind stamp lifecycle: in -> hold (success, until RESULT ends the battle)
  //                       in -> crack -> gone (failure)
  const st = B.bindStamp;
  if (st) {
    st.t += dt;
    if (st.state === 'in' && st.t >= CFG.FX.BIND_STAMP_IN_MS / 1000) {
      st.state = st.success ? 'hold' : 'crack';
      st.t = 0;
    } else if (st.state === 'crack' && st.t >= CFG.FX.BIND_STAMP_CRACK_MS / 1000) {
      B.bindStamp = null;
    }
  }
}

// ============================================================================
// Sprite hook — optional PNG overlay on top of the CSS-square fallback.
// Failed names are tracked in a module-level Set so a missing file only ever
// 404s once, never retries/spams on subsequent renders.
// ============================================================================
const failedSprites = new Set();

function Sprite({ name, style }) {
  // Failure is derived from the module Set on every render (never cached in
  // state), so when a swapped familiar changes `name` the new sprite is
  // re-checked correctly; the state below exists only to force a re-render.
  const [, bump] = useState(0);
  if (failedSprites.has(name)) return null;
  return (
    <img
      src={`assets/${name}.png`}
      alt=""
      draggable={false}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        pointerEvents: 'none',
        ...style,
      }}
      onError={() => {
        failedSprites.add(name);
        bump((n) => n + 1);
      }}
    />
  );
}

// ============================================================================
// Small presentational helpers
// ============================================================================

// Decor glyphs: each renders as grass underneath plus an optional sprite over
// a simple CSS-shape fallback (circle/rect in ink tones). Walkability is NOT
// decided here — that's CFG.BLOCKING_GLYPHS via isBlockedGlyph.
const DECOR = {
  T: { sprite: 'tree', shape: 'circle', color: '#57603F', size: 0.85 },
  U: { sprite: 'fountain', shape: 'circle', color: '#44506B', size: 0.85 },
  W: { sprite: 'well', shape: 'circle', color: '#4A4036', size: 0.7 },
  t: { sprite: 'statue', shape: 'rect', color: '#6E675C', size: 0.6 },
  f: { sprite: 'flowers', shape: 'circle', color: '#B65C40', size: 0.4 },
};

function tileStyle(ch) {
  const base = { width: CFG.TILE_SIZE, height: CFG.TILE_SIZE };
  if (DECOR[ch]) return { ...base, background: CFG.COLORS.grass }; // decor sits on grass
  switch (ch) {
    case '#':
      return { ...base, background: CFG.COLORS.ink, boxShadow: 'inset 0 0 4px rgba(0,0,0,0.6)' };
    case '+':
      return { ...base, background: CFG.COLORS.gold, boxShadow: 'inset 0 0 8px rgba(0,0,0,0.35)' };
    case "'":
      return { ...base, background: CFG.COLORS.grass };
    case ',':
      return {
        ...base,
        background: '#C8B589',
        backgroundImage:
          'repeating-linear-gradient(45deg, rgba(43,38,32,0.35) 0, rgba(43,38,32,0.35) 2px, transparent 2px, transparent 8px)',
      };
    default:
      return { ...base, background: '#D9C7A0' }; // '.' and 'S'
  }
}

// CSS-shape fallback for a decor glyph — always painted; the PNG (when it
// exists) simply renders on top of it, same layering as every entity square.
function DecorShape({ def }) {
  const pad = ((1 - def.size) / 2) * 100;
  return (
    <div
      style={{
        position: 'absolute',
        inset: `${pad}%`,
        background: def.color,
        borderRadius: def.shape === 'circle' ? '50%' : 2,
        border: '1px solid rgba(28,24,18,0.55)',
        boxSizing: 'border-box',
      }}
    />
  );
}

function battleTileHighlight(G, col, row) {
  const B = G.battle;
  const out = [];
  if (B.slashFlashTimer > 0 && B.slashFlashTiles.some((t) => t.col === col && t.row === row)) out.push('slash');
  if (B.enemy.hp > 0 && B.enemy.telegraphActive) {
    if (B.enemySpecies === 'Grotesque' && col === 2 && row === B.enemy.row) out.push('telegraph');
    if (B.enemySpecies === 'Basilisk' && row === B.enemy.row) out.push('telegraph');
    // Snail-Knight lance: glows the player-side half of its locked row.
    if (B.enemySpecies === 'Snail-Knight' && col < 3 && row === B.enemy.lanceRow) out.push('telegraph');
  }
  return out;
}

function resultText(reason, extra) {
  if (reason === 'SUBDUED') return 'SUBDUED.';
  if (reason === 'DEFEAT') return 'THE INK RUNS DRY.';
  if (reason === 'BOUND') {
    return `BOUND. ${extra.species} joins the bestiary.${extra.partyFull ? ' PARTY FULL — RECORDED.' : ''}`;
  }
  return '';
}

// Shared "ink on parchment" chip styling for every HUD surface.
const HUD_FONT = 'Georgia, "Times New Roman", serif';
const HUD_CHIP = {
  background: 'rgba(232,220,196,0.88)',
  color: CFG.COLORS.ink,
  border: `1px solid ${CFG.COLORS.ink}`,
  borderRadius: 4,
  fontFamily: HUD_FONT,
  fontSize: 12,
};

function PartyChips({ party, activeIndex }) {
  return (
    <div style={{ display: 'flex', gap: 5 }}>
      {party.map((p, i) => {
        const fainted = p.hp <= 0;
        return (
          <div
            key={i}
            title={p.species}
            style={{
              width: 18,
              height: 18,
              position: 'relative',
              backgroundColor: CFG.FAMILIARS[p.species].color, // longhand, see HpBar
              // crosshatch fainted chips instead of just fading them out
              backgroundImage: fainted
                ? 'repeating-linear-gradient(45deg, rgba(28,24,18,0.65) 0, rgba(28,24,18,0.65) 2px, transparent 2px, transparent 5px)'
                : 'none',
              border: '1px solid #1c1812',
              borderRadius: 3,
              // gilt ring on the active chip (ring, not border, so size is stable)
              boxShadow: i === activeIndex ? `0 0 0 2px ${CFG.COLORS.gold}` : 'none',
              opacity: fainted ? 0.45 : 1,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                bottom: 0,
                height: 3,
                width: `${Math.max(0, p.hp / p.maxHp) * 100}%`,
                background: CFG.COLORS.gold,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

// Small corner indicator: ♪ when sound is on, struck-through when muted.
function MuteBadge({ muted, style }) {
  return (
    <div
      title="M toggles sound"
      style={{
        ...HUD_CHIP,
        position: 'absolute',
        padding: '2px 7px',
        zIndex: 5,
        opacity: muted ? 0.6 : 0.9,
        textDecoration: muted ? 'line-through' : 'none',
        ...style,
      }}
    >
      ♪{muted ? ' off' : ''}
    </div>
  );
}

function Hud({ G }) {
  const lead = G.party[0];
  return (
    <>
      <div
        style={{
          ...HUD_CHIP,
          position: 'absolute',
          top: 6,
          left: 6,
          padding: '6px 10px',
          lineHeight: 1.5,
          zIndex: 5,
        }}
      >
        <div style={{ fontWeight: 'bold' }}>Bestiary: {G.bestiary.size}/{CFG.TOTAL_SPECIES}</div>
        <div>{lead.species}: {Math.ceil(lead.hp)}/{lead.maxHp} HP</div>
        <div style={{ marginTop: 4 }}>
          <PartyChips party={G.party} activeIndex={0} />
        </div>
      </div>
      {/* area label — small-caps serif, top-right */}
      <div
        style={{
          ...HUD_CHIP,
          position: 'absolute',
          top: 6,
          right: 6,
          padding: '4px 10px',
          fontVariant: 'small-caps',
          letterSpacing: 1,
          zIndex: 5,
        }}
      >
        {CFG.AREA_NAME}
      </div>
      <MuteBadge muted={G.muted} style={{ bottom: 6, right: 6 }} />
    </>
  );
}

function StartOverlay({ onStart }) {
  return (
    <div
      onClick={onStart}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(20,16,12,0.94)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: 50,
        textAlign: 'center',
      }}
    >
      {failedSprites.has('title') ? (
        // Text fallback — only shown once the title art is known to be missing.
        // (The rAF tick re-renders this overlay every frame, so the swap from
        // image to text happens on the frame after the img's onError fires.)
        <div style={{ fontSize: 40, fontWeight: 'bold', color: CFG.COLORS.gold, marginBottom: 14, letterSpacing: 3 }}>
          INKBOUND
        </div>
      ) : (
        <Sprite
          name="title"
          style={{
            position: 'static', // in-flow, not the usual absolute overlay
            width: 'min(55vmin, 80%)',
            height: 'auto', // keep the source aspect ratio
            objectFit: 'contain',
            marginBottom: 14,
            borderRadius: 4,
            boxShadow: '0 4px 18px rgba(0,0,0,0.6)',
          }}
        />
      )}
      <div style={{ fontSize: 16, color: CFG.COLORS.parchment }}>Click to begin</div>
      <div style={{ fontSize: 12, color: CFG.COLORS.parchment, opacity: 0.7, marginTop: 10, maxWidth: 320 }}>
        Arrows/WASD move · Z bolt · X slash · C bind · Tab swap familiar · M mute
      </div>
    </div>
  );
}

function HpBar({ label, hp, maxHp, color, align }) {
  const pct = (Math.max(0, hp) / maxHp) * 100;
  return (
    <div style={{ width: 190, textAlign: align === 'right' ? 'right' : 'left', fontFamily: HUD_FONT }}>
      <div style={{ fontSize: 12, marginBottom: 2 }}>{label} {Math.max(0, Math.ceil(hp))}/{maxHp}</div>
      <div
        style={{
          height: 10,
          background: '#1c1812',
          border: `1px solid ${CFG.COLORS.ink}`,
          borderRadius: 5,
          overflow: 'hidden',
          display: 'flex',
          justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            backgroundColor: color, // longhand: avoids React shorthand/longhand style clash
            // subtle two-stop sheen over the flat fill color
            backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.28), rgba(0,0,0,0.18))',
            borderRadius: 4,
            transition: 'width 120ms ease-out',
          }}
        />
      </div>
    </div>
  );
}

function AbilitySlot({ label, name, icon, fill, disabled }) {
  return (
    <div
      style={{
        width: 132,
        height: 30,
        padding: '4px 6px',
        border: `1px solid ${CFG.COLORS.ink}`,
        background: disabled ? 'rgba(232,220,196,0.25)' : 'rgba(232,220,196,0.55)',
        opacity: disabled ? 0.55 : 1,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      {/* ability icon art (optional) — rendered FIRST so the cooldown-fill
          overlay below paints on top of it (icon sits under the fill). */}
      <Sprite
        name={icon}
        style={{
          inset: 'auto',
          right: 3,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 22,
          height: 22,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${clamp(fill, 0, 1) * 100}%`,
          background: 'rgba(201,162,39,0.4)',
          zIndex: 0,
        }}
      />
      {/* key label on a translucent parchment chip so it stays readable over
          both the icon art and the cooldown fill */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          fontSize: 11,
          fontWeight: 'bold',
          color: CFG.COLORS.ink,
          background: 'rgba(232,220,196,0.75)',
          padding: '0 3px',
          borderRadius: 2,
          marginRight: 24, // keep clear of the icon on the right
          whiteSpace: 'nowrap',
        }}
      >
        {label} · {name}
      </div>
    </div>
  );
}

function AbilityBar({ B, activeStats, bindable }) {
  const boltFill = 1 - B.boltCdTimer / activeStats.boltCd;
  const slashFill = 1 - B.slashCdTimer / CFG.SLASH_CD;
  const bindFill = B.bindCdTimer > 0 ? 1 - B.bindCdTimer / CFG.BIND_FAIL_CD : bindable ? 1 : 0;
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
      <AbilitySlot label="Z" name="Gilt Bolt" icon="icon-inkwell" fill={boltFill} disabled={B.boltCdTimer > 0} />
      <AbilitySlot label="X" name="Marginal Slash" icon="icon-slash" fill={slashFill} disabled={B.slashCdTimer > 0} />
      <AbilitySlot label="C" name="Wax Seal" icon="icon-seal" fill={bindFill} disabled={!bindable || B.bindCdTimer > 0} />
    </div>
  );
}

// ============================================================================
// Phase views
// ============================================================================
function OverworldView({ G }) {
  const OW = G.overworld;
  const tiles = [];
  for (let y = 0; y < CFG.MAP_ROWS; y++) {
    for (let x = 0; x < CFG.MAP_COLS; x++) {
      const ch = MAP[y][x];
      const decor = DECOR[ch];
      tiles.push(
        <div
          key={`${x}-${y}`}
          style={{ position: 'absolute', left: x * CFG.TILE_SIZE, top: y * CFG.TILE_SIZE, ...tileStyle(ch) }}
        >
          {/* shrine art layered over the gold square (which stays as fallback) */}
          {ch === '+' && <Sprite name="shrine" />}
          {/* decor: CSS shape fallback first, sprite art painted over it */}
          {decor && (
            <>
              <DecorShape def={decor} />
              <Sprite name={decor.sprite} />
            </>
          )}
        </div>
      );
    }
  }
  return (
    <div style={{ position: 'relative', padding: '10px 0' }}>
      <div
        style={{
          position: 'relative',
          width: CFG.MAP_COLS * CFG.TILE_SIZE,
          height: CFG.MAP_ROWS * CFG.TILE_SIZE,
          margin: '0 auto',
          border: `3px solid ${CFG.COLORS.ink}`,
        }}
      >
        {tiles}
        <div
          style={{
            position: 'absolute',
            width: CFG.TILE_SIZE,
            height: CFG.TILE_SIZE,
            left: 0,
            top: 0,
            transform: `translate(${OW.playerX * CFG.TILE_SIZE}px, ${OW.playerY * CFG.TILE_SIZE}px)`,
            transition: `transform ${CFG.STEP_ANIM_MS}ms linear`,
            background: CFG.COLORS.indigo,
            border: '2px solid #1c1812',
            boxSizing: 'border-box',
          }}
        >
          <Sprite name="scribe" />
        </div>
        {OW.shrineFlashTimer > 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: CFG.COLORS.gold,
              opacity: (OW.shrineFlashTimer / 0.4) * 0.5,
              pointerEvents: 'none',
            }}
          />
        )}
        <Hud G={G} />
      </div>
    </div>
  );
}

function TransitionView({ G }) {
  const stage = G.transitionStage;
  return (
    <div style={{ position: 'relative', width: '100%', height: CFG.MAP_ROWS * CFG.TILE_SIZE + 20, background: '#000' }}>
      {(stage === 'flash1' || stage === 'flash2') && (
        <div style={{ position: 'absolute', inset: 0, background: CFG.COLORS.parchment, filter: 'invert(1)' }} />
      )}
      {stage === 'wipe' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* escaping-beast vignette, dimmed behind the announcement text */}
          <Sprite name="margin-escape" style={{ objectFit: 'contain', opacity: 0.45 }} />
          <div
            style={{
              position: 'relative', // stacks above the vignette
              color: CFG.COLORS.vermilion,
              fontSize: 28,
              fontWeight: 'bold',
              letterSpacing: 2,
              textAlign: 'center',
              padding: '0 20px',
              textShadow: '0 2px 10px rgba(0,0,0,0.95), 0 0 4px rgba(0,0,0,0.9)',
            }}
          >
            A BEAST SLIPS THE MARGIN!
          </div>
        </div>
      )}
    </div>
  );
}

function BattleView({ G, resultOverlay }) {
  const B = G.battle;
  if (!B) return null;
  const activeMember = G.party[B.activeIndex];
  const activeStats = CFG.FAMILIARS[activeMember.species];
  const bindable = B.enemy.hp / B.enemy.maxHp <= CFG.BIND_HP_THRESHOLD;

  const tiles = [];
  for (let row = 0; row < CFG.BROWS; row++) {
    for (let col = 0; col < CFG.BCOLS; col++) {
      const isPlayerSide = col < 3;
      const highlights = battleTileHighlight(G, col, row);
      let background;
      if (highlights.includes('telegraph')) background = 'rgba(193,68,14,0.55)';
      else if (highlights.includes('slash')) background = 'rgba(201,162,39,0.55)';
      else if (isPlayerSide) background = 'repeating-linear-gradient(0deg,#F3E9D2,#F3E9D2 7px,#ECDFBE 8px)';
      else background = 'linear-gradient(135deg,#D8B48C,#C79571)';
      tiles.push(
        <div
          key={`${col}-${row}`}
          style={{
            position: 'absolute',
            left: col * CFG.BTILE,
            top: row * CFG.BTILE,
            width: CFG.BTILE,
            height: CFG.BTILE,
            boxSizing: 'border-box',
            border: '1px solid rgba(43,38,32,0.25)',
            background,
          }}
        />
      );
    }
  }

  return (
    <div style={{ position: 'relative', padding: '10px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 8px', marginBottom: 6 }}>
        <HpBar label={activeMember.species} hp={activeMember.hp} maxHp={activeMember.maxHp} color={CFG.COLORS.indigo} />
        <HpBar
          label={B.enemySpecies}
          hp={B.enemy.hp}
          maxHp={B.enemy.maxHp}
          color={bindable ? CFG.COLORS.gold : CFG.COLORS.vermilion}
          align="right"
        />
      </div>
      <div style={{ padding: '0 8px', marginBottom: 8 }}>
        <PartyChips party={G.party} activeIndex={B.activeIndex} />
      </div>

      {/* Manuscript-page dressing: a padded ring around the grid filled with
          the parchment texture, with the ornate page-frame stretched over it
          so the (opaque) grid sits inside the frame's blank center. Both are
          optional art — with no assets this is just transparent padding and
          the battle looks exactly as before. Gameplay readability is safe by
          construction: tiles, telegraphs, entities and projectiles all render
          inside the opaque grid, above this dressing. */}
      <div
        style={{
          position: 'relative',
          width: CFG.BCOLS * CFG.BTILE + 2 * CFG.FRAME_PAD,
          margin: '0 auto',
          padding: CFG.FRAME_PAD,
          // screen shake: offsets computed by the rAF loop (stepBattleEffects),
          // zero outside the decaying SHAKE_MS window after player damage.
          transform: `translate(${B.shakeX || 0}px, ${B.shakeY || 0}px)`,
        }}
      >
        <Sprite name="parchment" style={{ objectFit: 'cover' }} />
        <Sprite name="page-frame" style={{ objectFit: 'fill', opacity: 0.9 }} />
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            width: CFG.BCOLS * CFG.BTILE,
            height: CFG.BROWS * CFG.BTILE,
            border: `3px solid ${CFG.COLORS.ink}`,
          }}
        >
          {tiles}
        <div
          style={{
            position: 'absolute',
            left: 3 * CFG.BTILE - 1,
            top: 0,
            width: 2,
            height: CFG.BROWS * CFG.BTILE,
            background: CFG.COLORS.ink,
            opacity: 0.6,
          }}
        />

        {/* player familiar — outer div positions + idle-bobs (pure cosmetic
            CSS keyframes), inner div carries the fallback square, border and
            drop-shadow. Rendered at ENTITY_SCALE of the tile for presence. */}
        <div
          style={{
            position: 'absolute',
            width: ENT_SIZE,
            height: ENT_SIZE,
            left: B.playerCol * CFG.BTILE + ENT_OFF,
            top: B.playerRow * CFG.BTILE + ENT_OFF,
            opacity: B.iframeTimer > 0 && Math.floor(B.iframeTimer * 10) % 2 === 0 ? 0.35 : 1,
            animation: `inkbound-bob ${CFG.FX.BOB_S}s ease-in-out infinite`,
            zIndex: 2,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: activeStats.color,
              border: '2px solid #1c1812',
              boxSizing: 'border-box',
              filter: 'drop-shadow(0 5px 6px rgba(20,16,12,0.4))',
            }}
          >
            <Sprite name={activeMember.species.toLowerCase()} />
          </div>
        </div>

        {/* wild enemy — same outer/inner split; the bob is phase-offset via a
            negative animation-delay so the pair don't move in lockstep. */}
        {B.enemy.hp > 0 && (
          <div
            style={{
              position: 'absolute',
              width: ENT_SIZE,
              height: ENT_SIZE,
              left: B.enemy.col * CFG.BTILE + ENT_OFF,
              top: B.enemy.row * CFG.BTILE + ENT_OFF,
              animation: `inkbound-bob ${CFG.FX.BOB_S}s ease-in-out infinite`,
              animationDelay: `-${CFG.FX.BOB_S / 2}s`,
              zIndex: 2,
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: CFG.COLORS.vermilion,
                border: '2px solid #1c1812',
                boxSizing: 'border-box',
                // withdrawn shell: smaller + desaturated; hit flash brightens
                transform: B.enemy.shelled ? 'scale(0.8)' : 'scale(1)',
                transition: 'transform 150ms ease, filter 150ms ease',
                filter: [
                  B.enemy.shelled ? 'grayscale(0.85)' : '',
                  B.enemy.hitFlashTimer > 0 ? 'brightness(1.8)' : '',
                  'drop-shadow(0 5px 6px rgba(20,16,12,0.4))',
                ].filter(Boolean).join(' '),
                // riled tell: pulsing vermilion glow
                animation: B.enemy.riled ? 'inkbound-rile 0.9s ease-in-out infinite' : 'none',
              }}
            >
              <Sprite name={B.enemySpecies.toLowerCase()} />
              {/* vermilion flash after a failed bind */}
              {B.enemy.bindFailFlashTimer > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: CFG.COLORS.vermilion,
                    opacity: (B.enemy.bindFailFlashTimer / (CFG.FX.BIND_FAIL_FLASH_MS / 1000)) * 0.75,
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* projectiles */}
        {B.projectiles.map((p) => (
          <div
            key={p.id}
            style={{
              position: 'absolute',
              width: 14,
              height: 14,
              left: p.x * CFG.BTILE + CFG.BTILE / 2 - 7,
              top: p.row * CFG.BTILE + CFG.BTILE / 2 - 7,
              borderRadius: p.owner === 'player' ? 3 : 8,
              background: p.owner === 'player' ? CFG.COLORS.gold : CFG.COLORS.vermilion,
              boxShadow: '0 1px 3px rgba(0,0,0,0.6)',
              zIndex: 3, // above entities, as before the entity restructure
            }}
          />
        ))}

        {/* bind seal stamp on the enemy tile: scales in, then holds (success,
            until RESULT) or cracks apart (failure). Timers live in B.bindStamp,
            ticked by stepBattleEffects. Vermilion circle doubles as the
            zero-asset fallback under the seal-bound art. */}
        {B.bindStamp && (() => {
          const st = B.bindStamp;
          let scale = 1;
          let opacity = 1;
          let rotate = -8;
          if (st.state === 'in') {
            scale = Math.min(1, st.t / (CFG.FX.BIND_STAMP_IN_MS / 1000));
          } else if (st.state === 'crack') {
            const k = Math.min(1, st.t / (CFG.FX.BIND_STAMP_CRACK_MS / 1000));
            opacity = 1 - k;
            rotate = -8 + k * 70;
            scale = 1 + k * 0.35;
          }
          return (
            <div
              style={{
                position: 'absolute',
                left: B.enemy.col * CFG.BTILE,
                top: B.enemy.row * CFG.BTILE,
                width: CFG.BTILE,
                height: CFG.BTILE,
                transform: `scale(${scale}) rotate(${rotate}deg)`,
                opacity,
                zIndex: 4,
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: '12%',
                  borderRadius: '50%',
                  background: 'rgba(193,68,14,0.8)',
                  border: '2px solid rgba(28,24,18,0.6)',
                }}
              />
              <Sprite name="seal-bound" />
            </div>
          );
        })()}

        {/* floating damage numbers: gilt gold for damage dealt, vermilion for
            damage taken; rise and fade over their DMG_NUM_MS lifetime. */}
        {B.damageNumbers.map((d) => {
          const k = Math.min(1, d.t / (CFG.FX.DMG_NUM_MS / 1000));
          return (
            <div
              key={d.id}
              style={{
                position: 'absolute',
                left: d.col * CFG.BTILE,
                top: d.row * CFG.BTILE,
                width: CFG.BTILE,
                textAlign: 'center',
                transform: `translateY(${-k * CFG.FX.DMG_NUM_RISE_PX}px)`,
                opacity: 1 - k,
                color: d.kind === 'dealt' ? CFG.COLORS.gold : CFG.COLORS.vermilion,
                fontFamily: HUD_FONT,
                fontWeight: 'bold',
                fontSize: 18,
                textShadow: '0 1px 3px rgba(20,16,12,0.85), 0 0 2px rgba(20,16,12,0.7)',
                zIndex: 5,
                pointerEvents: 'none',
              }}
            >
              {d.amount}
            </div>
          );
        })}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <AbilityBar B={B} activeStats={activeStats} bindable={bindable} />
      </div>

      <MuteBadge muted={G.muted} style={{ bottom: 12, right: 8 }} />

      {resultOverlay && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(20,16,12,0.88)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            zIndex: 20,
            overflow: 'hidden',
          }}
        >
          {/* wax-seal art stamped behind the BOUND text (bind success only) */}
          {resultOverlay.reason === 'BOUND' && (
            <Sprite
              name="seal-bound"
              style={{
                inset: 'auto', // replace the default full-bleed placement
                left: '50%',
                top: '50%',
                width: '30vmin',
                height: '30vmin',
                transform: 'translate(-50%, -50%) rotate(-8deg)', // stamped feel
                borderRadius: 6,
                boxShadow: '0 6px 24px rgba(0,0,0,0.7)',
              }}
            />
          )}
          <div
            style={{
              position: 'relative', // stacks above the seal art
              fontSize: 28,
              fontWeight: 'bold',
              color: resultOverlay.reason === 'DEFEAT' ? CFG.COLORS.vermilion : CFG.COLORS.gold,
              letterSpacing: 1,
              textAlign: 'center',
              padding: '4px 24px',
              // translucent ink chip + shadow keep the text readable over the
              // opaque seal art (and are invisible-in-practice without it)
              background: 'rgba(20,16,12,0.55)',
              borderRadius: 4,
              textShadow: '0 2px 8px rgba(0,0,0,0.9)',
            }}
          >
            {resultText(resultOverlay.reason, resultOverlay.extra)}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Root component
// ============================================================================
export default function Inkbound() {
  const wrapperRef = useRef(null);
  const gameRef = useRef(null);
  if (gameRef.current === null) {
    gameRef.current = makeInitialGame(); // lazy-init once; avoids rebuilding every render
  }
  const rafIdRef = useRef(null);
  const lastTsRef = useRef(null);
  const [, setTick] = useState(0); // bumped once per rAF frame to trigger a render
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false); // mirror for the mount-once key handlers

  // Single effect: attach input listeners + start the one and only rAF loop.
  // Runs once on mount; cleans up fully on unmount (listeners + rAF + timers).
  useEffect(() => {
    lastTsRef.current = null;

    function onKeyDown(e) {
      // Arrows/space/Tab must never scroll the page or move focus.
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(e.key)) {
        e.preventDefault();
      }
      if (!startedRef.current) return; // keyboard is inert behind the click-to-begin overlay
      const action = actionFromKey(e);
      if (!action) return;
      const input = gameRef.current.input;
      if (!e.repeat) input.pressed.add(action); // one-shot buffer ignores OS auto-repeat
      input.held.add(action);
    }
    function onKeyUp(e) {
      const action = actionFromKey(e);
      if (!action) return;
      gameRef.current.input.held.delete(action);
    }
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);

    // ------------------------------------------------------------------
    // The one game loop. Delta-time driven; idles (no battle work) outside
    // BATTLE, but always keeps running so ref-mutations made by timeouts
    // (TRANSITION/RESULT staging) still get picked up on the next frame's
    // render-tick bump — no separate setState calls needed for those.
    // ------------------------------------------------------------------
    function loop(ts) {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      let dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      dt = Math.min(dt, 0.05); // clamp so a stalled tab doesn't cause huge jumps

      const G = gameRef.current;

      // M: mute toggle — phase-independent, cosmetic only (audio never gates
      // or times gameplay, so this lives outside the phase switch).
      if (G.input.pressed.has('mute')) {
        G.muted = !G.muted;
        sfxSetMuted(G.muted);
      }

      switch (G.phase) {
        case 'OVERWORLD':
          stepOverworld(G, dt);
          break;
        case 'BATTLE':
          stepBattle(G, dt);
          break;
        default:
          break; // TRANSITION / RESULT: no per-frame simulation, just overlays
      }
      // Visual-effect timers tick whenever a battle object exists (BATTLE and
      // RESULT) so bind stamps / shakes / damage numbers settle correctly.
      stepBattleEffects(G, dt);

      G.input.pressed.clear(); // one-shot buffer consumed exactly once per frame
      setTick((t) => t + 1); // sync to React state at most once per frame
      rafIdRef.current = requestAnimationFrame(loop);
    }
    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      cancelAnimationFrame(rafIdRef.current);
      gameRef.current.timeouts.forEach((id) => clearTimeout(id));
      gameRef.current.timeouts = [];
    };
  }, []);

  const G = gameRef.current;
  const phase = G.phase;

  function handleStart() {
    startedRef.current = true;
    setStarted(true);
    initAudio(); // AudioContext needs a user gesture; this click is it
    if (wrapperRef.current) wrapperRef.current.focus();
  }

  let content = null;
  if (phase === 'OVERWORLD') content = <OverworldView G={G} />;
  else if (phase === 'TRANSITION') content = <TransitionView G={G} />;
  else if (phase === 'BATTLE') content = <BattleView G={G} />;
  else if (phase === 'RESULT') {
    content = <BattleView G={G} resultOverlay={{ reason: G.battle.resultReason, extra: G.battle.resultExtra }} />;
  }

  return (
    <div
      ref={wrapperRef}
      tabIndex={0}
      style={{
        position: 'relative',
        width: OUTER_WIDTH,
        margin: '20px auto',
        background: '#201c17',
        border: `4px solid ${CFG.COLORS.ink}`,
        color: CFG.COLORS.parchment,
        outline: 'none',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {/* purely-cosmetic CSS keyframes (idle bob, riled glow) — the only
          animation timing NOT driven by the rAF loop, per the M3 brief */}
      <style>{`
        @keyframes inkbound-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-${CFG.FX.BOB_PX}px); }
        }
        @keyframes inkbound-rile {
          0%, 100% { box-shadow: 0 0 3px 1px rgba(193,68,14,0.45); }
          50% { box-shadow: 0 0 14px 5px rgba(193,68,14,0.9); }
        }
      `}</style>
      <div
        style={{
          textAlign: 'center',
          padding: '8px 0 4px',
          letterSpacing: 4,
          fontWeight: 'bold',
          color: CFG.COLORS.gold,
          fontSize: 20,
          borderBottom: `2px solid ${CFG.COLORS.ink}`,
        }}
      >
        INKBOUND
      </div>
      {content}
      {!started && <StartOverlay onStart={handleStart} />}
    </div>
  );
}
