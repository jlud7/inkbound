#!/usr/bin/env node
// ============================================================================
// generate-assets.mjs — one-shot sprite generator for INKBOUND, via Replicate.
//
// Node >= 18, ZERO npm dependencies (uses global fetch + a hand-rolled .env
// parser). Reads config from process.env first, falling back to a .env file
// in the project root, falling back to the defaults below.
//
// Usage:
//   node scripts/generate-assets.mjs                        # generate anything missing
//   node scripts/generate-assets.mjs --dry-run              # print the plan, no network calls
//   node scripts/generate-assets.mjs --only=title,shrine    # restrict to specific manifest names
//   node scripts/generate-assets.mjs --force                # regenerate even if the PNG exists
//   node scripts/generate-assets.mjs --remove-bg            # strip backgrounds from sprite-type PNGs
//
// By default any manifest name whose public/assets/<name>.png already exists
// is SKIPPED (so re-running never clobbers art you already paid for); pass
// --force to regenerate. The printed budget plan only counts images actually
// being generated. --dry-run makes zero network calls and works with no token.
//
// --remove-bg post-processes the sprite-type PNGs in TRANSPARENT_NAMES through
// Replicate's 851-labs/background-remover (~$0.0005/run, budgeted at $0.001):
// files that already have an alpha channel are skipped, everything else is
// replaced in-place with a transparent-background PNG.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'assets');

// ----------------------------------------------------------------------------
// Tiny hand-rolled .env parser — no dotenv dependency. Lines of KEY=VALUE,
// blank lines and lines starting with # are ignored. Values are not quoted.
// ----------------------------------------------------------------------------
function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

const fileEnv = parseEnvFile(path.join(ROOT, '.env'));
function getEnv(key, fallback) {
  return process.env[key] ?? fileEnv[key] ?? fallback;
}

const REPLICATE_API_TOKEN = getEnv('REPLICATE_API_TOKEN', '');
const IMAGE_MODEL = getEnv('IMAGE_MODEL', 'openai/gpt-image-2');
const IMAGE_QUALITY = getEnv('IMAGE_QUALITY', 'medium');
const MAX_BUDGET_USD = parseFloat(getEnv('MAX_BUDGET_USD', '4.50'));
// A malformed value would parse to NaN, and `total > NaN` is always false —
// which would silently disable the budget abort. Refuse to run instead.
if (!Number.isFinite(MAX_BUDGET_USD)) {
  console.error('ABORT: MAX_BUDGET_USD is not a valid number — fix it in .env.');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const REMOVE_BG = process.argv.includes('--remove-bg');
// --only=name1,name2 restricts generation to the named manifest entries.
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg
  ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean)
  : null;

// ----------------------------------------------------------------------------
// Manifest — one entry per sprite, consistent prompt style across all of them.
// ----------------------------------------------------------------------------
const STYLE_PREFIX =
  'medieval illuminated-manuscript marginalia creature, aged parchment tones, ' +
  'iron-gall ink linework, vermilion and gilt accents, single centered subject, ' +
  'plain solid light background, video-game sprite, no text';

// Ability icons share their own style template (mirrors the creature prefix,
// but "miniature icon ... single centered object ... video-game ability icon").
const iconPrompt = (subject) =>
  `medieval illuminated manuscript miniature icon of ${subject}, aged parchment tones, ` +
  'iron-gall ink linework, vermilion and gilt accents, single centered object, ' +
  'plain solid light background, video-game ability icon, no text';

const MANIFEST = [
  { name: 'scribe', prompt: `${STYLE_PREFIX} — hooded monk scribe in indigo robes, quill in hand` },
  { name: 'quill', prompt: `${STYLE_PREFIX} — small feather-spirit familiar, wispy and lightweight` },
  { name: 'drollery', prompt: `${STYLE_PREFIX} — whimsical hybrid critter, part rabbit part bird, mischievous` },
  { name: 'grotesque', prompt: `${STYLE_PREFIX} — hulking gargoyle-like guardian, stone-hewn and hunched` },
  { name: 'basilisk', prompt: `${STYLE_PREFIX} — serpentine crowned reptile, coiled and regal` },
  {
    name: 'title',
    prompt:
      "medieval illuminated manuscript title page for a game called INKBOUND, the word 'INKBOUND' in ornate gilt " +
      'gothic lettering, a winged hare and a crowned serpent entwined in a flourishing vine border, aged parchment, ' +
      'iron-gall ink, vermilion and gold leaf, indigo accents, no other text',
  },
  {
    name: 'shrine',
    prompt:
      'medieval illuminated manuscript miniature of a small stone cloister shrine with a glowing golden reliquary ' +
      'and a single candle, gilt halo, aged parchment tones, iron-gall ink linework, vermilion and gilt accents, ' +
      'single centered subject, plain solid light background, video-game sprite, no text',
  },
  { name: 'icon-inkwell', prompt: iconPrompt('a black inkwell with a white goose-quill feather, gold leaf rim') },
  { name: 'icon-slash', prompt: iconPrompt("a scribe's penknife crossed with a sweeping vermilion ink slash stroke") },
  { name: 'icon-seal', prompt: iconPrompt("a round vermilion wax seal stamped with a beast's paw print, gilt highlights") },
  {
    name: 'page-frame',
    prompt:
      'ornate medieval illuminated manuscript page border frame, gold leaf and vermilion acanthus vines with tiny ' +
      'drollery creatures woven around all four edges, completely empty blank aged-parchment center, no text',
  },
  {
    name: 'parchment',
    prompt:
      'plain aged parchment paper texture, subtle foxing stains and fibers, warm cream tone, evenly lit, ' +
      'no objects, no text',
  },
  {
    name: 'seal-bound',
    prompt:
      'large round vermilion sealing-wax seal stamped with an ornate heraldic beast emblem, gold leaf flourishes, ' +
      'aged parchment background, single centered object, no text',
  },
  {
    name: 'margin-escape',
    prompt:
      'medieval illuminated manuscript vignette of a shadowy inky beast slipping out of the ruled margin of an ' +
      'open book page, trailing splattered iron-gall ink, vermilion accents, aged parchment, dramatic lighting, no text',
  },
];

// Sprite-type assets that should end up with transparent backgrounds via
// --remove-bg. Full-bleed art (title, page-frame, parchment, seal-bound,
// margin-escape) intentionally stays opaque.
const TRANSPARENT_NAMES = [
  'scribe', 'quill', 'drollery', 'grotesque', 'basilisk',
  'shrine', 'icon-inkwell', 'icon-slash', 'icon-seal',
];

const BG_REMOVE_MODEL = '851-labs/background-remover';
const BG_REMOVE_COST = 0.001; // conservative per-run estimate (actual ~$0.0005)

// Conservative per-image cost estimates in USD. Replicate does not publish
// exact pricing for gpt-image-2, so these are deliberately padded above what
// we expect the real cost to be, and are enforced strictly against the
// configured budget before any spend happens.
const COST_TABLE = { low: 0.03, medium: 0.08, high: 0.30 };
const MAX_IMAGES = 20; // hard cap regardless of budget math

// ----------------------------------------------------------------------------
// Job selection — applies --only filtering, then the skip-if-exists default
// (unless --force), then the hard image cap. Logs each skip so a "0 images"
// plan is never mysterious.
// ----------------------------------------------------------------------------
function selectJobs() {
  let jobs = MANIFEST;

  if (ONLY) {
    const known = new Set(MANIFEST.map((m) => m.name));
    const unknown = ONLY.filter((n) => !known.has(n));
    if (unknown.length) {
      console.error(`ERROR: unknown --only name(s): ${unknown.join(', ')}`);
      console.error(`Valid names: ${MANIFEST.map((m) => m.name).join(', ')}`);
      process.exit(1);
    }
    jobs = MANIFEST.filter((m) => ONLY.includes(m.name));
  }

  if (!FORCE) {
    jobs = jobs.filter((m) => {
      if (fs.existsSync(path.join(OUT_DIR, `${m.name}.png`))) {
        console.log(`skipping ${m.name} (exists)`);
        return false;
      }
      return true;
    });
  }

  return jobs.slice(0, MAX_IMAGES); // hard cap regardless of budget math
}

// ----------------------------------------------------------------------------
// PNG alpha-channel check without any image library: a PNG file starts with
// an 8-byte signature followed by the IHDR chunk (4B length + 4B type +
// 4B width + 4B height + 1B bit depth + 1B color type). The color type byte
// therefore sits at absolute offset 25; value 6 = RGBA truecolour-with-alpha.
// ----------------------------------------------------------------------------
function hasAlphaChannel(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(26);
  fs.readSync(fd, buf, 0, 26, 0);
  fs.closeSync(fd);
  return buf[25] === 6;
}

// ----------------------------------------------------------------------------
// Bg-removal job selection: only names in TRANSPARENT_NAMES; a name is queued
// if its PNG exists without an alpha channel, or if it's about to be generated
// in this same run (fresh gpt-image-2 output is opaque RGB).
// ----------------------------------------------------------------------------
function selectBgRemovalJobs(genJobs) {
  if (!REMOVE_BG) return [];
  const willGenerate = new Set(genJobs.map((j) => j.name));
  const jobs = [];
  for (const name of TRANSPARENT_NAMES) {
    if (willGenerate.has(name)) {
      jobs.push(name);
      continue;
    }
    const filePath = path.join(OUT_DIR, `${name}.png`);
    if (!fs.existsSync(filePath)) continue; // nothing on disk to process
    if (hasAlphaChannel(filePath)) {
      console.log(`skipping ${name} bg-removal (already has alpha)`);
      continue;
    }
    jobs.push(name);
  }
  return jobs;
}

// ----------------------------------------------------------------------------
// Budget plan — always printed, even in --dry-run. Only the images actually
// being generated / processed (post skip/--only filtering) count against the
// budget: generations at the quality's COST_TABLE rate, removals at $0.001.
// ----------------------------------------------------------------------------
function printPlanAndCheckBudget(jobs, bgJobs) {
  const n = jobs.length;
  const m = bgJobs.length;
  const perImage = COST_TABLE[IMAGE_QUALITY] ?? COST_TABLE.medium;
  const total = n * perImage + m * BG_REMOVE_COST;

  console.log('--- INKBOUND asset generation plan ---');
  console.log(`Model:        ${IMAGE_MODEL}`);
  console.log(`Quality:      ${IMAGE_QUALITY}`);
  console.log(`Images:       ${n}${n ? ` (${jobs.map((mj) => mj.name).join(', ')})` : ''}`);
  if (REMOVE_BG) {
    console.log(`Bg removals:  ${m}${m ? ` (${bgJobs.join(', ')})` : ''} via ${BG_REMOVE_MODEL}`);
  }
  console.log(
    `Est. cost:    ${n} x $${perImage.toFixed(2)}` +
      (REMOVE_BG ? ` + ${m} x $${BG_REMOVE_COST.toFixed(3)}` : '') +
      ` = $${total.toFixed(2)}`
  );
  console.log(`Budget cap:   $${MAX_BUDGET_USD.toFixed(2)}`);
  console.log(
    'Note: COST_TABLE values are conservative, safe over-estimates — Replicate ' +
      'does not publish exact per-image pricing for gpt-image-2 — enforced against MAX_BUDGET_USD.'
  );

  if (n === 0 && m === 0) {
    console.log('All requested assets already exist — nothing to generate.');
    return;
  }
  if (total > MAX_BUDGET_USD) {
    console.error(`ABORT: estimated cost $${total.toFixed(2)} exceeds MAX_BUDGET_USD $${MAX_BUDGET_USD.toFixed(2)}.`);
    process.exit(1);
  }
}

// ----------------------------------------------------------------------------
// Replicate API calls
// ----------------------------------------------------------------------------

// Shared prediction runner: POST with Prefer:wait, then poll if the prediction
// is still running — capped at ~5 minutes so a stuck prediction fails loudly
// instead of hanging. Returns the succeeded prediction object.
// `endpoint` + `body` are caller-supplied because Replicate has two flavors:
// official models use /v1/models/{model}/predictions with {input}, while
// community models (like the bg remover) 404 there and must use
// /v1/predictions with {version, input}.
async function runPrediction(endpoint, body, label) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait', // ask Replicate to hold the request open until the prediction finishes
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Replicate request failed for "${label}": ${res.status} ${await res.text()}`);
  }
  let prediction = await res.json();

  let polls = 0;
  const MAX_POLLS = 200; // 200 x 1.5s = 5 min
  while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
    if (++polls > MAX_POLLS) {
      throw new Error(`Prediction for "${label}" still ${prediction.status} after 5 minutes — giving up.`);
    }
    await new Promise((r) => setTimeout(r, 1500));
    const pollRes = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
    });
    prediction = await pollRes.json();
  }

  if (prediction.status !== 'succeeded') {
    throw new Error(`Prediction for "${label}" ended with status "${prediction.status}"`);
  }
  return prediction;
}

// Pull the first output URL off a prediction and download it as a Buffer.
async function downloadOutput(prediction, label) {
  // Output may be a single URL string or an array of URLs depending on model version.
  const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!output) throw new Error(`No output URL returned for "${label}"`);
  const imgRes = await fetch(output);
  return Buffer.from(await imgRes.arrayBuffer());
}

async function generateOne({ name, prompt }) {
  const prediction = await runPrediction(
    `https://api.replicate.com/v1/models/${IMAGE_MODEL}/predictions`,
    {
      input: {
        prompt,
        aspect_ratio: '1:1',
        quality: IMAGE_QUALITY,
        output_format: 'png',
        number_of_images: 1,
      },
    },
    name
  );

  const buf = await downloadOutput(prediction, name);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), buf);
  console.log(`Saved ${name}.png`);
}

// The bg remover is a community model, so predictions must be created via the
// version-based endpoint. Resolve (and cache) its latest version id once.
let bgModelVersion = null;
async function getBgModelVersion() {
  if (bgModelVersion) return bgModelVersion;
  const res = await fetch(`https://api.replicate.com/v1/models/${BG_REMOVE_MODEL}`, {
    headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`Could not resolve ${BG_REMOVE_MODEL} version: ${res.status} ${await res.text()}`);
  }
  const model = await res.json();
  bgModelVersion = model.latest_version?.id;
  if (!bgModelVersion) throw new Error(`${BG_REMOVE_MODEL} has no latest_version`);
  return bgModelVersion;
}

// Strip the background from one existing sprite PNG, replacing it in place.
// Input names verified against the model's published OpenAPI schema
// (latest_version.openapi_schema → Input properties): `image` (URI string,
// required) and `format` (string, default "png"); the default background_type
// "rgba" already produces a transparent result.
async function removeBackground(name) {
  const filePath = path.join(OUT_DIR, `${name}.png`);
  const dataUri = `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
  const version = await getBgModelVersion();
  const prediction = await runPrediction(
    'https://api.replicate.com/v1/predictions',
    { version, input: { image: dataUri, format: 'png' } },
    `${name} bg-removal`
  );
  const buf = await downloadOutput(prediction, `${name} bg-removal`);

  // Safety: only overwrite the original if the result really is a PNG with an
  // alpha channel — otherwise leave the original untouched (no conversion or
  // renaming) and report it so the caller can investigate.
  const isPng =
    buf.length > 26 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!isPng || buf[25] !== 6) {
    console.warn(`WARNING: bg-removal output for "${name}" is not an RGBA PNG — original left in place.`);
    return false;
  }
  fs.writeFileSync(filePath, buf);
  console.log(`Saved ${name}.png (transparent background)`);
  return true;
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------
async function main() {
  const jobs = selectJobs();
  const bgJobs = selectBgRemovalJobs(jobs);
  printPlanAndCheckBudget(jobs, bgJobs);

  if (DRY_RUN) {
    console.log('--dry-run: no network calls made.');
    return;
  }
  if (jobs.length === 0 && bgJobs.length === 0) return;

  if (!REPLICATE_API_TOKEN) {
    console.error('ERROR: REPLICATE_API_TOKEN is not set (checked process.env and .env). Aborting.');
    process.exit(1);
  }

  for (const job of jobs) {
    console.log(`Generating ${job.name}...`);
    await generateOne(job);
  }

  for (const name of bgJobs) {
    console.log(`Removing background: ${name}...`);
    await removeBackground(name);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
