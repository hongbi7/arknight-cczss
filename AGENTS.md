# Repository Guidelines

This repository is an Arknights operator guessing game. `public/` holds the static vanilla-JS frontend, `api/` and `server.js` form the HTTP layer, and `lib/game.js` contains the shared game and anti-cheat logic used by both local and Vercel deployments.

## Project Structure & Module Organization

- `public/`: frontend assets (`index.html`, `css/style.css`, `js/app.js`, `data/names.json`, `img/`).
- `api/`: Vercel serverless handlers (`new.js`, `guess.js`, `choices.js`, `pick.js`, `reveal.js`).
- `lib/game.js`: token encryption, dimension comparison, and distractor scoring.
- `server.js`: local zero-dependency server that reuses the API handlers.
- `server-data/operators.json`: full server-only operator archive; never expose it to clients.
- `scripts/build_data.py`: Python pipeline that generates the two committed data files.
- `vercel.json`: static hosting and API routing configuration.

## Build, Test, and Development Commands

```bash
npm start            # Start the local server at http://localhost:3000
npm run build:data   # Regenerate server-data/operators.json and public/data/names.json
```

Node.js 18+ is required. Data generation needs Python with `pypinyin`; the source JSON paths are hardcoded at the top of `scripts/build_data.py`. There is no frontend build step.

## Coding Style & Naming Conventions

Use 2-space indentation and double-quoted strings in JavaScript to match the existing code. Keep Node modules CommonJS (`require`/`module.exports`), variables camelCase, constants uppercase, API files named after their endpoint (`api/guess.js` -> `/api/guess`), and CSS classes kebab-case (`cell-wrong`). Use 4-space indentation in Python and follow the script's existing data-handling pattern. Do not introduce a framework without a clear reason.

## Testing Guidelines

No automated test framework or coverage threshold is configured. Validate changes with `npm start`: exercise `sudden` and `endless` modes, the final four-way choice, reveal, and error paths. For core game changes, verify responses never leak the answer name before a win or reveal. If tests are added, place them beside the module and name them by behavior (for example, `lib/game.test.js`).

## Commit & Pull Request Guidelines

The existing Git history uses short, descriptive messages focused on a single change. Prefer concise imperative messages such as `Add endless mode` or `Fix token replay`. Pull requests should describe the behavior change, link related issues, and include screenshots for UI or data-rendering updates. When data rules change, run `npm run build:data` and commit both generated data files.

## Security & Configuration Tips

Set `GAME_SECRET` to a long random string in production; without it the code falls back to `local-dev-secret`. Changing the secret invalidates active tokens. Keep `server-data/operators.json` server-only and never include answer data in API responses before the player wins or reveals.
