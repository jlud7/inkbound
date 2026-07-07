# INKBOUND

**Play it: https://jlud7.github.io/inkbound/** (auto-deploys from `main` via GitHub Actions)

You are a scribe in a medieval scriptorium. The beasts illuminated in the margins of your bestiary have slipped off the page. Explore the cloister grounds, corner them, weaken them, and bind them back into the book — your bound beasts become familiars that fight for you.

## Controls

Arrows/WASD move · Z bolt · X slash · C bind · Tab swap familiar

## Run it

```
npm install
npm run dev
```

Open the printed local URL and click the "Click to begin" overlay to focus the game and start playing.

To build a production bundle:

```
npm run build
npm run preview
```

## Asset generation (optional)

The game runs fine with plain colored squares — generated sprites are a purely optional visual layer.

```
cp .env.example .env
# then edit .env and paste your Replicate API token

node scripts/generate-assets.mjs --dry-run   # prints the cost plan, makes zero network calls
node scripts/generate-assets.mjs             # generates the 5 sprites for real
```

The script prints its cost estimate and aborts before making any API calls if the total would exceed `MAX_BUDGET_USD` from your `.env`. Generated PNGs are written to `public/assets/` and picked up automatically by the game (missing files just fall back to the colored squares).
