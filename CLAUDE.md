# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A browser guessing game for Arknights (明日方舟) operators. The server hides one operator; the player types any operator's name and the server scores the guess across **12 archive dimensions** (职业/子职业/星级/站位/Tag/性别/战斗经验/出身地/生日/种族/身高/矿石病), showing exact/wrong matches plus higher/lower or earlier/later hints for numeric/date fields.

Two modes, both drawing from the same pool of 425 operators (`poolFor()` ignores mode):
- **sudden (突然死亡)**: 5 guesses, then a forced 4-option final pick (distractors are chosen to match the player's confirmed "green" dimensions).
- **endless (无尽)**: unlimited guesses.

## Commands

```bash
npm start               # local server at http://localhost:3000 (node server.js)
npm run build:data      # regenerate data files (python scripts/build_data.py)
```

- No frontend build step, no linter, no test suite — plain Node (CommonJS) + vanilla JS.
- Rebuilding data needs Python with `pypinyin`. The two source game JSONs are **not** in the repo; their absolute paths are hardcoded at the top of `scripts/build_data.py` (`CHAR_PATH`, `HANDBOOK_PATH`).

## Architecture

### Anti-cheat is the core design constraint

The answer must never reach the client; all logic lives in `lib/game.js`, which both runtimes share:
- `/api/new` picks a random operator, then `encrypt()` wraps `{name, mode, guesses}` in an **AES-256-GCM token** (IV+tag+payload, base64url). The key is `sha256(GAME_SECRET)`.
- `/api/guess` decrypts the token, compares the guess to the secret across 12 dims, and returns a **fresh token carrying the appended guess history** (needed later for distractor generation). The response never includes the answer name unless the player wins.
- `/api/reveal` decrypts and returns the answer (give-up path).
- `/api/choices` (sudden mode, after 5 misses) scores every operator by how many green keys they share with the secret (`greenKeys` + `matches`), takes the top 3 as distractors (excluding the secret and already-guessed names), and shuffles them with the real answer.
- `/api/pick` resolves the final 4-way choice.

The game is **stateless across requests** — everything lives in the encrypted token (no DB, no session store). Treat tokens as untrusted: `decrypt()` returns null on any tamper, surfaced as `invalid_session`.

### Request flow / file map

```
public/index.html, css/style.css, js/app.js      # static frontend (vanilla JS)
api/new.js | guess.js | choices.js | pick.js | reveal.js   # thin Vercel serverless HTTP wrappers
lib/game.js         # ALL logic — token crypto, dimension compare, distractor scoring
server.js           # local zero-dependency http server; reuses the same api/* handlers
server-data/operators.json   # full 12-dim archives keyed by operator name (SERVER-ONLY — never serve)
public/data/names.json       # name + full/initial pinyin + hot flag for search (no archives)
scripts/build_data.py        # Python pipeline: source JSONs → the two data files above
vercel.json         # static + serverless routing
```

The `api/*.js` handlers are identical in shape: OPTIONS preflight, parse body/query, delegate to `lib/game.js`, set JSON headers, map errors to status codes (`unknown_operator` → 404, `invalid_session`/`bad_request` → 400). `server.js` imports the same handlers, so local dev and Vercel stay in sync.

### Data pipeline (Python)

`scripts/build_data.py` parses two game dump JSONs and writes:
- `server-data/operators.json` — keyed by operator `name`; each record: `id`, `name`, `hot`, `rarity`, `position`, `profession`/`professionText`, `subProfessionId`/`subProfessionText`, `tags`, `gender`, `exp`/`expText`, `origin`, `birthday`/`birthdayText`, `race`, `height`/`heightText`, `infected`/`infectedText`.
- `public/data/names.json` — array of `{n, p, i, hot}` (name, full pinyin, initial letters, rarity≥5 flag).

**Both files are generated artifacts that must be committed to git** — the deployed site has no data otherwise. After changing any data rule (e.g. adding a new sub-profession to `SUBPROFESSION_ZH`), rebuild and commit them. The script handles messy source data: exp variants ("格斗经验/表演经验/…") normalized to years, Chinese numerals, robots' 产地/高度/设定性别 field mapping, corrupted entries.

### Dimension comparison semantics (`lib/game.js::dimResult`)

- Per-dimension state is one of `exact | wrong | high | low | before | after | unknown`.
- Numeric fields (rarity, exp, height) use `cmp(guess, secret)`: state is **relative to the guess** — `high` means the guess is greater than the answer. Birthday compares `month*100+day`, reporting `before`/`after`.
- `unknown` when either side is null/missing (robots have no birthday); frontend renders grey `?`.
- `tags` is special: state is always `hint`, returning the shared (intersection) tags.
- `SUDDEN_MAX = 5` (sudden-mode guess cap) lives in `lib/game.js`.

### Frontend (`public/js/app.js`)

- Loads `names.json` once into a `namesIndex` + `validNames` set; input must match a valid name or the top suggestion.
- Pinyin fuzzy search: subsequence matching over full pinyin (`p`) and initials (`i`), scored, top-8 dropdown with arrow-key/Enter/Escape handling (IME-composition aware).
- New guess rows are **prepended** to the table; win/fail and the final 4-way choice use the `victory` / `choiceModal` overlays.
- Mode persists in `localStorage["ak-mode"]` and auto-resumes on load.

## Production notes

- Set `GAME_SECRET` (any long random string) as a Vercel env var; without it the code falls back to `local-dev-secret`. Changing the secret invalidates all in-flight tokens.
- Deploy: Vercel (static `public` + `api/*.js` serverless, configured in `vercel.json`), or any long-running host via `npm start`; Cloudflare Pages would need the five handlers rewritten as `functions/` Workers (logic in `lib/game.js` is portable).
- `hot` (rarity ≥ 5) drives suggestion sort and the "热门" badge; the rule lives in `scripts/build_data.py` (`rarity >= 5`).
