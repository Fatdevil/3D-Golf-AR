# Tests

| Command | What it does |
|---|---|
| `npm test` | Runs every `tests/test_*.js` (physics, roll, putt distances, azimuth, green math, sculpt math). Fails on a non-zero exit or a ❌/REGRESSION line. `KNOWN` in `tests/run.js` lists failures that exist today. |
| `npm --prefix tests install` and `npm --prefix tests run setup` | One-time setup of the smoke test: the libraries, then the Chromium browser (kept out of the root `package.json` so Railway does not install them). Skip `setup` if you point `CHROMIUM_PATH` at an existing Chromium. |
| `npm run smoke` | Opens `arcade.html` in headless Chromium and compares it with `tests/smoke/baseline.json`: no new page errors, no lost `window` globals, the shared top-level variables still exist, plus behaviour checks (putt line holes out, putt power, Tour Pro odds). |
| `node tests/test_voice_commands.js` | (ingår i `npm test`) Röstkommandon: svenska och engelska fraser blir rätt kommando, vanligt prat blir inget. Smoke-testet prövar dessutom knappen mot en låtsasigenkännare. |
| `E2E_DATABASE_URL=postgres://user@127.0.0.1:5432/golf_test npm run e2e` | Saved and published courses end to end: the real `server.js` against a real Postgres on localhost (the test refuses any other host) and the real pages in Chromium. Draft, reopen, publish, new version, My drafts / My published, the working copy, play copy, delete. Needs `npm install` in the root too. It only touches rows of its own. |
| `npm run smoke -- --update` | Rewrites the baseline. Do this only when a change is intended. |

`tests/manual/` holds exploratory scripts that print numbers and do not check anything. They are not run by `npm test`.

The smoke test needs a Chromium. It uses `CHROMIUM_PATH`, else `/opt/pw-browsers/chromium-*`, else the one installed by `npm --prefix tests run setup`.
