# Tests

| Command | What it does |
|---|---|
| `npm test` | Runs every `tests/test_*.js` (physics, roll, putt distances, azimuth, green math, sculpt math). Fails on a non-zero exit or a ❌/REGRESSION line. `KNOWN` in `tests/run.js` lists failures that exist today. |
| `npm --prefix tests install` and `npm --prefix tests run setup` | One-time setup of the smoke test: the libraries, then the Chromium browser (kept out of the root `package.json` so Railway does not install them). Skip `setup` if you point `CHROMIUM_PATH` at an existing Chromium. |
| `npm run smoke` | Opens `arcade.html` in headless Chromium and compares it with `tests/smoke/baseline.json`: no new page errors, no lost `window` globals, the shared top-level variables still exist, plus behaviour checks (putt line holes out, putt power, Tour Pro odds). |
| `npm run smoke -- --update` | Rewrites the baseline. Do this only when a change is intended. |

`tests/manual/` holds exploratory scripts that print numbers and do not check anything. They are not run by `npm test`.

The smoke test needs a Chromium. It uses `CHROMIUM_PATH`, else `/opt/pw-browsers/chromium-*`, else the one installed by `npm --prefix tests run setup`.
