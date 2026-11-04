# Tests

| Command | What it does |
|---|---|
| `npm test` | Runs every `tests/test_*.js` (physics, roll, putt distances, azimuth, green math, sculpt math). Fails on a non-zero exit or a ❌/REGRESSION line. `KNOWN` in `tests/run.js` lists failures that exist today. |
| `node tools/fit-hitbox.js [--height 15] <fil.glb>` | Anpassar träffytan (höjdskikt och stam) efter en modells trianglar och skriver ut den. Testet `tests/test_hitbox_fit.js` ingår i `npm test`. |
| `node tools/check-glb.js <fil.glb>` | Kontrollerar GLB-modeller mot spelets budget (trianglar, filstorlek, texturer, material, form). Testet `tests/test_glb_check.js` ingår i `npm test`. |
| `npm --prefix tests install` and `npm --prefix tests run setup` | One-time setup of the smoke test: the libraries, then the Chromium browser (kept out of the root `package.json` so Railway does not install them). Skip `setup` if you point `CHROMIUM_PATH` at an existing Chromium. |
| `npm run smoke` | Opens `arcade.html` in headless Chromium and compares it with `tests/smoke/baseline.json`: no new page errors, no lost `window` globals, the shared top-level variables still exist, plus behaviour checks (putt line holes out, putt power, Tour Pro odds). |
| `npm run smoke:shape` | Opens `arcade.html` and `arcade_mobile.html` in headless Chromium (phone and desktop viewports): the draw / straight / fade buttons and the mobile club row are visible and tappable (nothing on top of them, also on small landscape and compact portrait phones), the club buttons pick the club, and a fade / draw reaches the physics as a positive / negative spin axis. The input mode picker (swing / launch monitor / numbers) switches the UI, is remembered, and defaults to the swing UI on a phone. On the mobile page the shot goes where the camera looks (also after dragging it), a second shot is ignored while the ball is flying, and the launch monitor panel never covers the buttons. The mobile page's rules are played through: a normal stop, holed (and the next hole), water and out of bounds (the ball goes back, a penalty stroke), a gimme, the scorecard and the end of the round, and a real putt on the real physics that drops. The mobile menu lists the published courses from the server (and handles a server that is down). `SHOTS=<dir>` also saves screenshots. |
| `node tests/test_voice_commands.js` | (ingår i `npm test`) Röstkommandon: svenska och engelska fraser blir rätt kommando, vanligt prat blir inget. Smoke-testet prövar dessutom knappen mot en låtsasigenkännare. |
| `E2E_DATABASE_URL=postgres://user@127.0.0.1:5432/golf_test npm run e2e` | Saved and published courses end to end: the real `server.js` against a real Postgres on localhost (the test refuses any other host) and the real pages in Chromium. Draft, reopen, publish, new version, My drafts / My published, the working copy, play copy, delete. Needs `npm install` in the root too. It only touches rows of its own. |
| `E2E_DATABASE_URL=postgres://user@127.0.0.1:5432/golf_test node tests/e2e/collections-e2e.js` | Collections of several plates over HTTP against the real `server.js` and a real Postgres on localhost (no browser): the plate list is checked on save (too many, twice, missing, draft, range), the total par is the server's own, and the collection's leaderboard adds up one go over all plates. |
| `npm run smoke -- --update` | Rewrites the baseline. Do this only when a change is intended. |

`tests/manual/` holds exploratory scripts that print numbers and do not check anything. They are not run by `npm test`.

The smoke test needs a Chromium. It uses `CHROMIUM_PATH`, else `/opt/pw-browsers/chromium-*`, else the one installed by `npm --prefix tests run setup`.

## CI

`.github/workflows/ci.yml` runs on pull requests, kept small because Actions minutes are limited (about 43 minutes for everything, almost all of it the browser tests):

- `unit` (`npm test`) and `api` (the e2e tests against a Postgres service) run on every pull request and every push to it, about a minute each.
- `browser` (the smoke test, the shape smoke test and the courses e2e in headless Chromium, each as its own job) runs only when the pull request has the label `browser-tests`: adding the label starts them, and later pushes run them again. By hand: Actions → CI → Run workflow runs everything on the chosen branch.
- Nothing runs on the push to `main` after a merge (the pull request was tested), nor when only `.md` files or `docs/` change.

A job that fails shows which test it was in its log. The browser tests can also be run locally (see the table above) before pushing.
