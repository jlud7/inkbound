# INKBOUND — Design Vision & World Bible

*A living document. The MVP proves the loop; this maps where it goes. Written 2026-07-06.*

---

## The Pitch

You are a scribe in a half-finished abbey at the edge of the world, and the book you tend is coming apart. Every beast ever doodled in a margin — every winged hare, knight-snail, and crowned serpent — is slipping off the page and into the grounds. Explore the abbey, corner the escaped marginalia in real-time grid duels, weaken them, and **bind** them back into your bestiary — where they become your familiars and fight at your side.

**Pokémon's heart** (collect, bond, badge-quest, rival) **with Mega Man Battle Network's hands** (real-time 6×3 grid combat that rewards positioning, timing, and telegraph-reading).

## Design Pillars

1. **The book is the world.** Every system wears manuscript skin: menus are folios, abilities are illuminated initials, save points are colophons, damage is spilled ink. If a mechanic can't be expressed in book language, it doesn't belong.
2. **Combat is a duel of pens, not a slugfest.** Fights are short (30–90 seconds), readable, and won by footwork — seam control, telegraph punishes, cooldown discipline — never by grinding stats.
3. **Binding beats beating.** Defeating a beast is the consolation prize; the real prize is the risk/reward of binding it at low HP while it's angriest. Your collection *is* your arsenal (max party of 6 — house rule, now canon).
4. **The anti-neon.** Parchment, iron-gall, vermilion, gilt, indigo. Warm, aged, tactile. When the whole world glows, nothing does; ours smoulders.

---

## The World: The Abbey of the Unfinished Page

A sprawling abbey whose founding bestiary was never completed — and an unfinished page is a door. The game is structured as **eight Folios** (regions), each kept by an **Illuminator** (the gym-leader analog): a master of one pigment who tests scribes and grants a **Pigment Seal**. Eight seals re-bind the book's spine and open **The Colophon** — the endgame chapter you enter by stepping *into* the book itself.

### The Eight Folios

| # | Folio (Region) | Illuminator | Combat Lesson Taught | Seal | Signature Beast |
|---|----------------|-------------|----------------------|------|-----------------|
| I | The Cloister Garden | Sister Wren, *the Verdant Hand* | Seam control & positioning | Verdigris | Green Man |
| II | The Scriptorium Hall | Brother Aldous, *the Gall-Keeper* | Cooldown discipline (ink runs dry) | Gall | Ape Scribe |
| III | The Herbarium | Prioress Mallow, *the Simpler* | Status effects & cleansing | Woad | Mandrake |
| IV | The Undercroft | Brother Ossian, *the Bone-Limner* | Reading telegraphs in candle-dark | Bone | Blemmye |
| V | The Bell Tower | Sexton Corvus, *the Ringer* | Rhythm — attacks land on bell beats | Leaden | Cockatrice |
| VI | The Cellars | Cellarer Brix, *the Tallow Light* | Terrain panels (slick, torn, burning) | Tallow | Bonnacon |
| VII | The Chained Library | The Librarian, *Keeper of Spines* | Multi-enemy formations | Lapis | Amphisbaena |
| VIII | The Leads (Rooftops) | The Anchoress, *the Sky Margin* | All of it, fast — a glass-cannon duel | Gilt | Wyvern of the Weathervane |

Each Illuminator fight is a hand-built boss with a unique grid gimmick (Corvus's arena attacks only on bell beats; Ossian's panels go dark outside your lantern's cross). Beating one grants their Seal, opens the next Folio, and unlocks one shop tier.

### The Colophon (Endgame)

With eight seals set, the book opens from the inside. The Colophon is a dungeon of pure page — rule lines for horizon, marginalia weather — culminating in the **Wyrm of the Colophon**: the first beast ever drawn, so long it coils through *all six columns* of the battle grid, fought in phases as you sever its coils from your own territory. Unbindable on first clear; New Game+ scribes may attempt the Final Binding.

---

## Pigments (The Type System)

Six inks, kept deliberately simple — one triangle, one rivalry, one wildcard:

- **Minium** (red) → beats **Verdigris** (green) → beats **Lapis** (blue) → beats **Minium**
- **Gall** (black) and **Gilt** (gold) are super-effective *against each other* — high-risk mirror
- **Bone** (white) resists Gall, hits nothing hard, dies to nothing hard — the tank pigment

Player-side, pigment lives on abilities and familiars; a Verdigris familiar's bolt bites Lapis beasts. Nothing deeper than that — depth belongs to the grid.

---

## The Bestiary (target roster: ~24, all genuine marginalia)

**Already off the page (in game):** Drollery (Verdigris, winged hare jester) · Grotesque (Bone, hunched gargoyle) · Basilisk (Minium, crowned glass cannon) · Snail-Knight (Bone, armored jouster — shells up between lance charges).

**Next escapes:**
- **Ape Scribe** (Gall) — steals a key: disables one ability slot for 3s
- **Green Man** (Verdigris) — foliate face; overgrows your panels into brambles
- **Mandrake** (Verdigris) — uprooted scream stuns your row (long telegraph, brutal punish)
- **Bonnacon** (Minium) — charges through its own columns, leaves burning panels
- **Cockatrice** (Minium) — gaze petrifies one of your columns for 2s
- **Amphisbaena** (Lapis) — two heads fire opposite rows simultaneously
- **Blemmye** (Bone) — headless mimic; repeats your last move back at you
- **Wodewose** (Verdigris) — wild man; enrages below half HP (move+fire speed up)
- **Owl of the Margins** (Gall) — night-only; swaps panel ownership briefly
- **Pelican-in-her-Piety** (Gilt) — heals itself; teaches "bind the healer first"
- **Hedgehog of the Vines** (Verdigris) — rolls a full row, armored while rolling
- **Bishop-Fish** (Lapis) — consecrates panels your slash can't cross
- **Sciapod** (Lapis) — one-legged leaper; shades under its foot (brief evasion)
- **Manticore** (Minium) — spine volleys in fans; miniboss-tier stat line

**Legendaries (one each, quest-gated):** **Unicorn of the Bestiary** (Gilt — flees battles; must be cornered via the Herbarium questline) · **Phoenix of the Gilded Edge** (Gilt — rekindles once at 1 HP; bind window is *after* the rekindle).

**Minibosses:** **The Palimpsest** (Gall — an erased beast that fights as a smudged copy of your active familiar) · **The Rubricator's Hound** (Minium — guards the red-ink stores in the Cellars) · **The Marginal Knight** (Bone — a rival duelist who challenges you in three escalating snail-jousts across the abbey).

---

## Combat Evolution

The 6×3 grid, seam rule, and Z/X/C/Tab kit stay sacred. Layered on top, in order:

1. **Versals** (the MMBN chip analog): collectible illuminated initials, equip up to 4, fired with V + direction or number keys. Examples: *V of Volley* (3-bolt fan), *S of Sanctuary* (bless one panel: first hit absorbed), *T of Tear* (rip an enemy panel for 4s), *M of Mirror* (next projectile reflected), *R of Rubric* (your row flashes red — big slash, long windup). Found in chests, quest rewards, and rare binds.
2. **Panel states:** *torn* (unusable), *inked* (damage-over-time to whoever stands there), *gilded* (blessed — one free hit), *slick* (movement slides one extra tile). Bosses and late beasts fight the floor as much as they fight you.
3. **Status effects (max 3, all short):** *Blotted* (your next telegraph is hidden), *Sodden* (move cooldown +40%), *Gilded* (shield one hit).
4. **Formations:** paired enemies from Folio VII on (a healer behind a tank teaches focus-fire and bind priority).
5. **Rile, deepened:** every failed bind permanently rachets THIS beast's aggression for the encounter — binding greed should feel like petting a lit candle.

## Familiars & Progression

- **XP and levels** for each bound familiar (shallow curves — a level 30 Drollery roughly doubles a level 1; no grind walls). Wild beasts scale by Folio, not by your level.
- **Second Illumination:** at high level + a rare pigment item, a familiar is "re-illuminated" — a gilt-edged evolved form with one new passive (Drollery → *Gilt Drollery*: +1 move speed, bolts pierce). One per species, hand-drawn.
- **Party of 6** (the house rule): Tab cycles living members mid-battle; team-building is choosing six answers to the grid.
- **Saving:** manuscript-appropriate — you save by *signing the colophon* at any shrine. (Requires persistent storage — see Open Decisions.)

## Side Quests & Secrets

- **The Snail Joust** — the Marginal Knight's three duels; final victory awards his mount as a bindable Snail-Knight with a unique lance versal.
- **Pigment Errands** — each Illuminator wants raw pigment (lapis from the flooded cellar, kermes from the herbarium, gold leaf from the rooftop reliquary). Rewards: seals' shop tiers, versals, one legendary lead.
- **The Overdue Bestiary** — the Librarian's list of rare escapees; each is a hand-placed hunt with a puzzle corner (the Owl only manifests during night bells).
- **Drop-Caps** — 26 hidden illuminated initials scattered in the world; collectible currency for versal crafting. Completionist reward: the *Alphabet Beast*.
- **Night Bells** — when the tower rings compline, encounter tables shift; three beasts exist only at night.

## Overworld Structure

Hub-and-spokes: the Cloister Garden is the hub; each Folio hangs off it and loops back via unlockable shortcuts (a Metroid-lite abbey, not a world map). Multi-screen regions with camera-follow; margin patches (encounter zones) get visually distinct "unfinished" treatments per region. Shrines heal and save; full-heal-on-defeat becomes shrine-only at M5 (already flagged in code). Day/night on a gentle real-time-ish cycle driven by steps, not the clock.

## Art & Audio Direction

- **Art:** every creature is a gpt-image-2 illuminated-manuscript piece run through background removal — 3/4 marginalia poses, iron-gall linework, the five-color palette. UI is book furniture: ribbon bookmarks for menus, rubricated headers, wax seals for confirmations. Never neon, never gradients-for-gradients'-sake.
- **Audio:** quill scratches for movement, vellum page-turns for menus, a struck-bell sting for encounters; low plainchant drones per Folio. Until then: tasteful square-wave blips (in progress), always mutable.

## Roadmap

- **M1 ✅ — The Loop** (shipped): overworld → encounter → 6×3 real-time battle → bind → party of 6.
- **M2 ✅ — The Illuminated Skin** (shipped): 14 generated art pieces, transparent sprite pipeline, title page, framed battles, Pages deploy.
- **M3 🔨 — Feel & Breadth** (in flight): bigger open map with decor, Snail-Knight (4th species), damage numbers, screen shake, idle animation, square-wave SFX + mute, HUD polish.
- **M4 — Bones of Progression:** XP/levels, colophon saves, versals v1 (equip 2), status effects v1.
- **M5 — Folio I complete:** Cloister region final form, Sister Wren boss fight, Verdigris Seal, roster to 8 species, shrine-only healing.
- **M6 — Folios II–III:** quests v1, shops, pigment system live.
- **M7 — Folios IV–VI:** night cycle, minibosses, panel states everywhere.
- **M8 — Folios VII–VIII + The Colophon:** formations, the Wyrm, credits. **v1.0 — "First Edition."**

## Open Decisions

- **Persistence:** the MVP constraint (no localStorage) came from its original single-file-artifact context; as a deployed site, M4 saves should just use localStorage (or export-a-save-file as a "loose leaf" — very on theme).
- **Engine ceiling:** one React file is honest up through ~M4; by M5 (multi-screen camera regions) we should split modules — same stack, more files. Canvas remains unnecessary; the DOM grid is the aesthetic.
- **Multiplayer jousts** (brother vs brother, link-cable energy): parked until the loop is undeniable.

---

*"Every margin is a door, and every door was drawn by someone who meant to finish."*
