#!/usr/bin/env node
// ============================================================================
// generate-assets.mjs — one-shot sprite generator for INKBOUND, via Replicate.
//
// Node >= 18, ZERO npm dependencies (uses global fetch + a hand-rolled .env
// parser). Reads config from process.env first, falling back to a .env file
// in the project root, falling back to the defaults below.
//
// Usage:
//   node scripts/generate-assets.mjs --dry-run   # print the plan, no network calls
//   node scripts/generate-assets.mjs             # actually generate + download
//
// NOTE: this script is written to be reviewed, not executed against the real
// API as part of this task. --dry-run makes zero network calls and works
// with no token present.
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

const DRY_RUN = process.argv.includes('--dry-run');

// ----------------------------------------------------------------------------
// Manifest — one entry per sprite, consistent prompt style across all of them.
// ----------------------------------------------------------------------------
const STYLE_PREFIX =
  'medieval illuminated-manuscript marginalia creature, aged parchment tones, ' +
  'iron-gall ink linework, vermilion and gilt accents, single centered subject, ' +
  'plain solid light background, video-game sprite, no text';

const MANIFEST = [
  { name: 'scribe', prompt: `${STYLE_PREFIX} — hooded monk scribe in indigo robes, quill in hand` },
  { name: 'quill', prompt: `${STYLE_PREFIX} — small feather-spirit familiar, wispy and lightweight` },
  { name: 'drollery', prompt: `${STYLE_PREFIX} — whimsical hybrid critter, part rabbit part bird, mischievous` },
  { name: 'grotesque', prompt: `${STYLE_PREFIX} — hulking gargoyle-like guardian, stone-hewn and hunched` },
  { name: 'basilisk', prompt: `${STYLE_PREFIX} — serpentine crowned reptile, coiled and regal` },
];

// Conservative per-image cost estimates in USD. Replicate does not publish
// exact pricing for gpt-image-2, so these are deliberately padded above what
// we expect the real cost to be, and are enforced strictly against the
// configured budget before any spend happens.
const COST_TABLE = { low: 0.03, medium: 0.08, high: 0.30 };
const MAX_IMAGES = 20; // hard cap regardless of budget math

// ----------------------------------------------------------------------------
// Budget plan — always printed, even in --dry-run.
// ----------------------------------------------------------------------------
function printPlanAndCheckBudget() {
  const n = Math.min(MANIFEST.length, MAX_IMAGES);
  const perImage = COST_TABLE[IMAGE_QUALITY] ?? COST_TABLE.medium;
  const total = n * perImage;

  console.log('--- INKBOUND asset generation plan ---');
  console.log(`Model:        ${IMAGE_MODEL}`);
  console.log(`Quality:      ${IMAGE_QUALITY}`);
  console.log(`Images:       ${n} (${MANIFEST.map((m) => m.name).join(', ')})`);
  console.log(`Est. cost:    ${n} x $${perImage.toFixed(2)} = $${total.toFixed(2)}`);
  console.log(`Budget cap:   $${MAX_BUDGET_USD.toFixed(2)}`);
  console.log(
    'Note: COST_TABLE values are conservative, safe over-estimates — Replicate ' +
      'does not publish exact per-image pricing for gpt-image-2 — enforced against MAX_BUDGET_USD.'
  );

  if (total > MAX_BUDGET_USD) {
    console.error(`ABORT: estimated cost $${total.toFixed(2)} exceeds MAX_BUDGET_USD $${MAX_BUDGET_USD.toFixed(2)}.`);
    process.exit(1);
  }
  return n;
}

// ----------------------------------------------------------------------------
// Replicate API calls
// ----------------------------------------------------------------------------
async function generateOne({ name, prompt }) {
  const res = await fetch(`https://api.replicate.com/v1/models/${IMAGE_MODEL}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait', // ask Replicate to hold the request open until the prediction finishes
    },
    body: JSON.stringify({
      input: {
        prompt,
        aspect_ratio: '1:1',
        quality: IMAGE_QUALITY,
        output_format: 'png',
        number_of_images: 1,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Replicate request failed for "${name}": ${res.status} ${await res.text()}`);
  }
  let prediction = await res.json();

  // If Prefer:wait didn't fully resolve it (long-running), poll until done.
  while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
    await new Promise((r) => setTimeout(r, 1500));
    const pollRes = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
    });
    prediction = await pollRes.json();
  }

  if (prediction.status !== 'succeeded') {
    throw new Error(`Prediction for "${name}" ended with status "${prediction.status}"`);
  }

  // Output may be a single URL string or an array of URLs depending on model version.
  const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!output) throw new Error(`No output URL returned for "${name}"`);

  const imgRes = await fetch(output);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), buf);
  console.log(`Saved ${name}.png`);
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------
async function main() {
  const n = printPlanAndCheckBudget();

  if (DRY_RUN) {
    console.log('--dry-run: no network calls made.');
    return;
  }

  if (!REPLICATE_API_TOKEN) {
    console.error('ERROR: REPLICATE_API_TOKEN is not set (checked process.env and .env). Aborting.');
    process.exit(1);
  }

  const jobs = MANIFEST.slice(0, n);
  for (const job of jobs) {
    console.log(`Generating ${job.name}...`);
    await generateOne(job);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
