# Repository Guidelines

This repository is an Arknights operator game with three modes: `sudden`, `endless`, and the ten-round `anomaly` audit. `public/` holds the static vanilla-JS frontend, `api/` and `server.js` form the HTTP layer, and `lib/game.js` plus `lib/anomaly.js` contain the shared game and token logic used by both local and Vercel deployments.

## Project Structure & Module Organization

- `public/`: frontend assets (`index.html`, `css/style.css`, `js/app.js`, `data/names.json`, `img/`).
- `api/`: Vercel serverless handlers for the original modes plus `api/anomaly/{themes,new,scan,answer,next}.js`.
- `lib/game.js`: original-mode token encryption, dimension comparison, and distractor scoring.
- `lib/anomaly.js`: anomaly run selection, encrypted session state, scanner, scoring, and review output.
- `server.js`: local zero-dependency server that reuses the API handlers.
- `server-data/operators.json`: full server-only operator archive; never expose it as a static client file.
- `server-data/anomaly-rules.json` and `server-data/anomaly-questions.json`: generated server-only audit rule and question banks; never copy them into `public/`.
- `server-data/operator-themes.json` and `server-data/operator-brand-art.json`: generated server-only directive theme bank and brand skin art mapping; never copy them into `public/`.
- `scripts/build_data.py`: base operator, clue, identity, and familiarity generation.
- `scripts/build_anomaly_data.py`: six-domain rule extraction, ambiguity audit, and deterministic question generation.
- `scripts/build_themes.py`: directive theme bank (reuses anomaly rule members) plus brand skin art mapping; runs after the anomaly bank.
- `scripts/extract_anomaly_skin_art.py`: extracts the exact skin portraits referenced by outfit-brand questions, with public-mirror fallback when the client cannot provide them.
- `scripts/run_data_build.js`: cross-platform data-build launcher that reuses a valid `.venv` and stops on a partial virtual-environment residue.
- `vercel.json`: static hosting and API routing configuration.

## Build, Test, and Development Commands

```bash
npm start            # Start the local server at http://localhost:3000
npm run build:data   # Regenerate base data, anomaly rules/questions, and the theme bank
npm run validate:data # Validate generated data and required assets
npm test             # Run original-mode and anomaly automated tests
npm run update:data:local # Run the full Windows GameData/client update pipeline
```

Node.js 24.x is required. Data generation needs Python with `pypinyin`; install `scripts/requirements-data.txt`. Set `ARKNIGHTS_GAMEDATA_ROOT` when GameData is outside the detected cache layouts. A complete repository `.venv` is reused, while an incomplete residue is reported and left untouched. There is no frontend build step.

## Coding Style & Naming Conventions

Use 2-space indentation and double-quoted strings in JavaScript to match the existing code. Keep Node modules CommonJS (`require`/`module.exports`), variables camelCase, constants uppercase, API files named after their endpoint (`api/guess.js` -> `/api/guess`), and CSS classes kebab-case (`cell-wrong`). Use 4-space indentation in Python and follow the script's existing data-handling pattern. Do not introduce a framework without a clear reason.

## Testing Guidelines

`npm test` runs `lib/game.test.js` and `lib/anomaly.test.js`; no coverage threshold is configured. For the original modes, also exercise `sudden`, `endless`, the final four-way choice, reveal, and error paths in a browser. For anomaly changes, exercise the in-terminal theme selector, mixed and single-domain runs, both initial mixed-mode scanner uses, the scanner reward after each three-answer correct streak, scanner-disabled single domains, outfit-brand skin art, wrong answers, the ten-round summary, invalid sessions, rapid confirmation, restart, mode switching, and mobile layouts. Verify the browser console is clean and responses do not identify the hidden original-mode answer or the current anomaly odd option before resolution. Place new tests beside the module and name them by behavior.

## Commit & Pull Request Guidelines

The existing Git history uses short, descriptive messages focused on a single change. Prefer concise imperative messages such as `Add endless mode` or `Fix token replay`. Pull requests should describe the behavior change, link related issues, and include screenshots for UI or data-rendering updates. When data rules change, run `npm run build:data` and commit every affected generated file, including anomaly banks and `server-data/data-version.json`.

## Security & Configuration Tips

Set `GAME_SECRET` to a long random string in production; without it both game engines fall back to the public `local-dev-secret`. Changing the secret invalidates active tokens. Keep all `server-data/` archives and anomaly banks server-only. An anomaly opening response may include the four option IDs/names/art, but must not include a stable question ID, `oddId`, `ruleId`, majority membership, evidence, or rule members. The client must replace its token after every successful anomaly request.

The anomaly audit currently uses stateless encrypted tokens. Old-token replay can bypass scanner consumption/penalties, so do not add leaderboards, prizes, or trusted competitive scores without server-side nonce/state validation. A public source checkout also exposes generated server data; the current threat model prevents direct API/static-file leakage, not offline cheating by someone who downloads the server source.

The six anomaly domains are `roster`, `identity`, `skill`, `battle`, `logistics`, and `visual`. Roster rules must not use rarity or tags, visual rules must not use CV, and the anomaly bank must not use birthday, height, combat experience, or confidential archive prose.
