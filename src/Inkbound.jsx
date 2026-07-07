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
  MAP_COLS: 15,
  MAP_ROWS: 15,
  TILE_SIZE: 36,
  STEP_MS: 140, // ms per overworld tile-step while a direction is held
  STEP_ANIM_MS: 100, // CSS glide duration for the avatar transform
  ENCOUNTER_CHANCE: 0.15, // per margin-tile step
  PITY_STEPS: 10, // guaranteed encounter on the Nth consecutive margin step

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
  TOTAL_SPECIES: 3, // Drollery, Grotesque, Basilisk

  RESULT_MS: 2000,

  COLORS: {
    parchment: '#E8DCC4',
    ink: '#2B2620',
    vermilion: '#C1440E',
    gold: '#C9A227',
    indigo: '#34405E',
  },

  // Player-side familiar stats. Slash/Bind are shared and unaffected by species.
  FAMILIARS: {
    Quill: { hp: 100, boltDmg: 8, boltCd: 1.0, boltSpeed: 8, moveCdMs: 120, color: '#34405E' },
    Drollery: { hp: 80, boltDmg: 6, boltCd: 0.7, boltSpeed: 8, moveCdMs: 90, color: '#8A6D3B' },
    Grotesque: { hp: 130, boltDmg: 10, boltCd: 1.4, boltSpeed: 8, moveCdMs: 120, color: '#5B6B3E' },
    Basilisk: { hp: 60, boltDmg: 13, boltCd: 1.0, boltSpeed: 12, moveCdMs: 120, color: '#6B3E63' },
  },

  // Wild enemy roster (encounter table). Weights must sum to 1.
  ENEMIES: {
    Drollery: { hp: 40, weight: 0.60, moveIntervalMs: 1200, fireMin: 2.0, fireMax: 3.0, boltSpeed: 6, boltDmg: 6 },
    Grotesque: { hp: 60, weight: 0.25, moveIntervalMs: 1800, telegraphMs: 500, swipeDmg: 15, swipeCdS: 2.5 },
    Basilisk: { hp: 30, weight: 0.15, moveIntervalMs: 1000, fireMin: 2.5, fireMax: 3.5, boltSpeed: 10, boltDmg: 12, telegraphMs: 400 },
  },
};

// ----------------------------------------------------------------------------
// Overworld map. Legend: # obstacle, . path, , unfinished margin (encounter),
// S spawn, + shrine. Border is fully walled. Verified reachable via BFS during
// authoring: shrine and both margin patches are all reachable from spawn.
// ----------------------------------------------------------------------------
const MAP = [
  '###############',
  '#....#....#...#',
  '#.##.#.##.#.#.#',
  '#.#..,,,..#.#.#',
  '#.#.##.##.#.#.#',
  '#.#.......#...#',
  '#.#.#####.###.#',
  '#.#.#...#.....#',
  '#...#.+.#.###.#',
  '#.###.#.#.#...#',
  '#.....#.#.#.#.#',
  '#.###.#.#.#.#.#',
  '#.#,,,.#...#..#',
  '#.#...#.####.S#',
  '###############',
];

const SPAWN = (() => {
  for (let y = 0; y < MAP.length; y++) {
    const x = MAP[y].indexOf('S');
    if (x !== -1) return { x, y };
  }
  return { x: 1, y: 1 };
})();

const OUTER_WIDTH = CFG.MAP_COLS * CFG.TILE_SIZE + 40;

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
  const table = [
    ['Drollery', CFG.ENEMIES.Drollery.weight],
    ['Grotesque', CFG.ENEMIES.Grotesque.weight],
    ['Basilisk', CFG.ENEMIES.Basilisk.weight],
  ];
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
    case 'Tab': return 'tab';
    default: return null;
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

function applyDamageToEnemy(G, dmg) {
  const B = G.battle;
  B.enemy.hp = Math.max(0, B.enemy.hp - dmg);
  B.enemy.hitFlashTimer = CFG.HIT_FLASH_MS / 1000;
}

function applyDamageToPlayer(G, dmg) {
  const B = G.battle;
  if (B.iframeTimer > 0) return; // i-frames block every damage source, incl. Grotesque swipes
  const active = G.party[B.activeIndex];
  if (active.hp <= 0) return; // already down, no double-dipping
  active.hp = Math.max(0, active.hp - dmg);
  B.iframeTimer = CFG.IFRAME_MS / 1000;
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

  if (Math.random() < chance) {
    G.bestiary.add(B.enemySpecies);
    let partyFull = false;
    if (G.party.length < CFG.PARTY_MAX) {
      const stats = CFG.FAMILIARS[B.enemySpecies];
      G.party.push({ species: B.enemySpecies, hp: stats.hp, maxHp: stats.hp });
    } else {
      partyFull = true;
    }
    enterResult(G, 'BOUND', { species: B.enemySpecies, partyFull });
  } else {
    // Riled: fire interval reduced 25%, Bind goes on cooldown.
    enemy.riled = true;
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
  }
  if (enemy.fireTimer >= enemy.nextFireInterval) {
    spawnProjectile(G, 'enemy', enemy.col - 1, enemy.row, base.boltSpeed, base.boltDmg);
    enemy.fireTimer = 0;
    enemy.telegraphActive = false;
    enemy.nextFireInterval = rand(base.fireMin, base.fireMax) * (enemy.riled ? CFG.BIND_RILE_FACTOR : 1);
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
  if (tile === '#') return; // blocked by hedge/wall
  OW.playerX = nx;
  OW.playerY = ny;
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
  B.enemy.hitFlashTimer = Math.max(0, B.enemy.hitFlashTimer - dt);

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
  }

  // --- collisions, then check for battle-ending conditions ---
  resolveCollisions(G);
  checkBattleEnd(G);
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
function tileStyle(ch) {
  const base = { width: CFG.TILE_SIZE, height: CFG.TILE_SIZE };
  switch (ch) {
    case '#':
      return { ...base, background: CFG.COLORS.ink, boxShadow: 'inset 0 0 4px rgba(0,0,0,0.6)' };
    case '+':
      return { ...base, background: CFG.COLORS.gold, boxShadow: 'inset 0 0 8px rgba(0,0,0,0.35)' };
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

function battleTileHighlight(G, col, row) {
  const B = G.battle;
  const out = [];
  if (B.slashFlashTimer > 0 && B.slashFlashTiles.some((t) => t.col === col && t.row === row)) out.push('slash');
  if (B.enemy.hp > 0 && B.enemy.telegraphActive) {
    if (B.enemySpecies === 'Grotesque' && col === 2 && row === B.enemy.row) out.push('telegraph');
    if (B.enemySpecies === 'Basilisk' && row === B.enemy.row) out.push('telegraph');
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

function PartyChips({ party, activeIndex }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {party.map((p, i) => (
        <div
          key={i}
          title={p.species}
          style={{
            width: 18,
            height: 18,
            position: 'relative',
            background: CFG.FAMILIARS[p.species].color,
            border: i === activeIndex ? `2px solid ${CFG.COLORS.gold}` : '1px solid #1c1812',
            opacity: p.hp <= 0 ? 0.3 : 1,
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
      ))}
    </div>
  );
}

function Hud({ G }) {
  const lead = G.party[0];
  return (
    <div
      style={{
        position: 'absolute',
        top: 6,
        left: 6,
        background: 'rgba(232,220,196,0.88)',
        color: CFG.COLORS.ink,
        padding: '6px 10px',
        borderRadius: 4,
        fontSize: 12,
        lineHeight: 1.5,
        zIndex: 5,
        border: `1px solid ${CFG.COLORS.ink}`,
      }}
    >
      <div style={{ fontWeight: 'bold' }}>Bestiary: {G.bestiary.size}/{CFG.TOTAL_SPECIES}</div>
      <div>{lead.species}: {Math.ceil(lead.hp)}/{lead.maxHp} HP</div>
      <div style={{ marginTop: 3 }}>
        <PartyChips party={G.party} activeIndex={0} />
      </div>
    </div>
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
        Arrows/WASD move · Z bolt · X slash · C bind · Tab swap familiar
      </div>
    </div>
  );
}

function HpBar({ label, hp, maxHp, color, align }) {
  const pct = (Math.max(0, hp) / maxHp) * 100;
  return (
    <div style={{ width: 190, textAlign: align === 'right' ? 'right' : 'left' }}>
      <div style={{ fontSize: 12, marginBottom: 2 }}>{label} {Math.max(0, Math.ceil(hp))}/{maxHp}</div>
      <div
        style={{
          height: 10,
          background: '#1c1812',
          border: '1px solid #000',
          display: 'flex',
          justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        }}
      >
        <div style={{ height: '100%', width: `${pct}%`, background: color }} />
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
      tiles.push(
        <div
          key={`${x}-${y}`}
          style={{ position: 'absolute', left: x * CFG.TILE_SIZE, top: y * CFG.TILE_SIZE, ...tileStyle(ch) }}
        >
          {/* shrine art layered over the gold square (which stays as fallback) */}
          {ch === '+' && <Sprite name="shrine" />}
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

        {/* player familiar */}
        <div
          style={{
            position: 'absolute',
            width: CFG.BTILE - 8,
            height: CFG.BTILE - 8,
            left: B.playerCol * CFG.BTILE + 4,
            top: B.playerRow * CFG.BTILE + 4,
            background: activeStats.color,
            border: '2px solid #1c1812',
            boxSizing: 'border-box',
            opacity: B.iframeTimer > 0 && Math.floor(B.iframeTimer * 10) % 2 === 0 ? 0.35 : 1,
          }}
        >
          <Sprite name={activeMember.species.toLowerCase()} />
        </div>

        {/* wild enemy */}
        {B.enemy.hp > 0 && (
          <div
            style={{
              position: 'absolute',
              width: CFG.BTILE - 8,
              height: CFG.BTILE - 8,
              left: B.enemy.col * CFG.BTILE + 4,
              top: B.enemy.row * CFG.BTILE + 4,
              background: CFG.COLORS.vermilion,
              border: '2px solid #1c1812',
              boxSizing: 'border-box',
              filter: B.enemy.hitFlashTimer > 0 ? 'brightness(1.8)' : 'none',
            }}
          >
            <Sprite name={B.enemySpecies.toLowerCase()} />
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
            }}
          />
        ))}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <AbilityBar B={B} activeStats={activeStats} bindable={bindable} />
      </div>

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
