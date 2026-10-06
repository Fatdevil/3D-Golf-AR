# Golf OS — Komplett Systemkarta (2026-05-02)

## Projekt
- **Namn:** 3D-Golf-AR / Golf OS
- **Sökväg:** `c:\Antigravety projekt\3D-Golf-AR\`
- **Deploy:** Railway (auto-deploy från GitHub `main`)
- **Repo:** `https://github.com/Fatdevil/3D-Golf-AR.git`
- **Stack:** Express + PostgreSQL + Vanilla JS (zero-toolchain, inga bundlers)
- **Entrypoint:** `server.js` → serverar statiska filer + API

---

## Arkitektur

```
arcade_hub.html          ← HUBBEN: välj aktivitet (Range/Courses/Build/Games)
    ↓ navigerar till
arcade.html              ← SINGLE SOURCE OF TRUTH: Builder + Play + Test
    ├── ?autorun=new_build              → Ny tom bana (BUILD mode)
    ├── ?autorun=edit_build&edit=CODE   → Ladda draft för redigering (BUILD)
    ├── ?autorun=setup&course=CODE      → Ladda publicerad bana (PLAY)
    ├── ?course=CODE&mode=range         → Driving range (TEST)
    └── (default, ingen param)          → TEST mode
```

### Moduler (alla som `<script src>` i arcade.html)
| Fil | Syfte |
|-----|-------|
| `arcade-auth.js` | Device ID auth (UUID i localStorage) |
| `arcade-feature-flags.js` | Free/Premium feature gating |
| `arcade-api-service.js` | Centraliserat HTTP API-lager med auth headers |
| `arcade-storage-service.js` | localStorage-abstraktion (drafts, compressed levels) |
| `arcade-swing-engine.js` | Swing meter UI + timing-logik |
| `arcade-scene-engine.js` | Three.js scen-setup (ljus, skybox, fog) |
| `arcade-tracer-engine.js` | Bollspår-rendering (Classic, Phantom, Pro Dot + premium) |
| `arcade-terrain-overlays.js` | Contour maps, heatmaps, pro grid |
| `arcade-perlin.js` | Perlin noise för terränggeneration |
| `arcade-lm-bridge.js` | WebSocket till Launch Monitor (SkyTrak/GSPro) på ws://localhost:8081 |
| `physics.js` | Ballistisk fysikmotor (drag, spin, bounce, roll) |
| `arcade.css` | Extraherad CSS |

### Viktiga globaler (window namespace)
| Variabel | Syfte |
|----------|-------|
| `window.G` | Game context: `{ scene, inputMode }` |
| `window.GolfAuth` | Auth state: `{ userId, user, isPremium }` |
| `window.FEATURE_FLAGS` | Feature gating config |
| `window.canUseFeature(key)` | Premium-check |
| `window.ArcadeAPI` | HTTP API methods |
| `window.ArcadeStorage` | localStorage helpers |
| `window.MAX_HOLES` | Konstant = 18 (max hål per terrain) |
| `window.players` | Array av spelare med `.scores[]`, `.name`, `.color` |
| `window.courseHoles` | Array[MAX_HOLES] med `.par`, `.tees`, `.flag`, etc. |
| `window.playingHoleIndex` | Aktuellt hål (0-indexed) |
| `currentEditCode` | share_code för bana under redigering |
| `window.lmConnected` | true om Launch Monitor är ansluten |

---

## Databas (PostgreSQL på Railway)

### Tabeller

```sql
-- ANVÄNDARE
users (
    id VARCHAR(50) PK,              -- Device UUID
    display_name VARCHAR(255),
    email VARCHAR(255),              -- NULL för device-only
    auth_provider VARCHAR(20),       -- 'device' | 'google' (framtida)
    is_premium BOOLEAN DEFAULT false,
    premium_plan VARCHAR(20),
    premium_until TIMESTAMP,
    builder_score INT DEFAULT 0,     -- +1 per spelad runda på dina banor
    created_at TIMESTAMP
)

-- BANOR
courses (
    id SERIAL PK,
    share_code VARCHAR(20) UNIQUE,   -- "ABC123" — publikt ID
    name VARCHAR(255),
    author VARCHAR(255),
    owner_id VARCHAR(50),            -- → users.id (vem byggde)
    holes JSONB,                     -- Array[18] med tees/flag/par per hål
    targets JSONB,
    trees JSONB,
    terrain_heightmap TEXT,          -- JSON: {ground: [...], water: [...]}
    terrain_biomemap TEXT,           -- Base64 JPEG
    theme_data JSONB,               -- {biomeId, config}
    hole_count INT,                  -- Dynamiskt räknat vid publicering
    total_par INT,                   -- Dynamiskt räknat vid publicering
    version INT DEFAULT 1,           -- Bumpar vid re-publish
    play_count INT DEFAULT 0,        -- Ökar per spelad runda
    likes INT DEFAULT 0,
    is_draft BOOLEAN,
    is_range BOOLEAN,
    is_hidden BOOLEAN DEFAULT false, -- Admin-moderering
    created_at TIMESTAMP,
    updated_at TIMESTAMP
)

-- RUNDRESULTAT / LEADERBOARD
course_records (
    id SERIAL PK,
    course_code VARCHAR(20),
    course_version INT,
    player_id VARCHAR(50),
    player_name VARCHAR(255),
    input_mode VARCHAR(20),          -- 'SWING_METER' | 'LAUNCH_MONITOR'
    lm_device VARCHAR(50),           -- 'SkyTrak' | 'Trackman' | NULL
    total_score INT,
    score_vs_par INT,
    hole_scores JSONB,
    stats JSONB,
    flagged BOOLEAN DEFAULT false,   -- Rimlighetskontroll
    tournament_id VARCHAR(20),       -- NULL = normal runda, annars turnerings-ID
    played_at TIMESTAMP
)

-- TURNERINGAR (grund lagd, ej UI ännu)
tournaments (
    id VARCHAR(20) PK,
    name VARCHAR(255),
    course_code VARCHAR(20),
    created_by VARCHAR(50),
    input_mode VARCHAR(20) DEFAULT 'ANY',
    starts_at TIMESTAMP,
    ends_at TIMESTAMP,
    max_players INT DEFAULT 0,
    is_public BOOLEAN DEFAULT true,
    description TEXT,
    created_at TIMESTAMP
)

-- ASSETS (admin-hanterade 3D-modeller)
custom_assets (id, name, category, subcategory, icon, file_data, config)

-- BIOMES (admin-hanterade miljöteman)
biomes (id, name, config)
```

---

## API-ytor

### Auth
| Endpoint | Metod | Syfte |
|----------|-------|-------|
| `POST /api/auth/register` | POST | Skapa/hämta user via device_id |
| `GET /api/users/:id` | GET | Hämta profil |
| `PUT /api/users/:id` | PUT | Uppdatera display_name (kräver auth) |

### Courses
| Endpoint | Metod | Syfte |
|----------|-------|-------|
| `GET /api/courses` | GET | Lista publicerade banor (exkl. draft, range, hidden) |
| `POST /api/courses` | POST | Spara/uppdatera bana (med ownership-check) |
| `GET /api/courses/:code` | GET | Ladda en bana |
| `POST /api/courses/:code/like` | POST | Gilla en bana |

### Leaderboard
| Endpoint | Metod | Syfte |
|----------|-------|-------|
| `POST /api/courses/:code/results` | POST | Spara rundresultat + sanity check + builder score |
| `GET /api/courses/:code/leaderboard` | GET | Hämta topplista (?mode=LAUNCH_MONITOR&period=month) |

### Ranges
| Endpoint | Metod | Syfte |
|----------|-------|-------|
| `GET /api/ranges` | GET | Lista publicerade ranges |

### Assets & Biomes (admin, lösenord: golfadmin123)
| Endpoint | Metod |
|----------|-------|
| `GET /api/assets` | Lista assets (utan file_data) |
| `GET /api/assets/:id/download` | Hämta asset med file_data |
| `POST /api/assets` | Spara/uppdatera (kräver password) |
| `DELETE /api/assets/:id` | Radera (kräver password) |
| `GET /api/biomes` | Lista biomes |
| `POST /api/biomes` | Spara/uppdatera (kräver adminPassword) |

---

## Bekräftade Designbeslut

| Beslut | Val |
|--------|-----|
| Auth | Device ID (auto-UUID) + valfri Google (framtida) |
| Betalmodell | Månad 49 kr + År 399 kr (Stripe, ej byggt ännu) |
| Free/Premium | Gameplay free, LM + premium-tracers + analytics bakom paywall |
| Leaderboard | Separerat LM vs Swing Meter, all-time + månad |
| Anti-fusk | Rimlighetskontroll (flagga, ej blockera) |
| Versionshantering | Ny version vid re-publish, leaderboard nollställs per version |
| Gamla versioner | Ej spelbara, leaderboard arkiveras |
| Builder Rewards | Badge + status (builder_score) |
| Edit-skydd | owner_id kontrolleras server-side, 403 om ej ägare |
| Moderering | Admin-flagga is_hidden |
| MAX_HOLES per terrain | 9 (obligatoriskt) |
| 18-hålsbana | "Make the Turn" = två 9-hålsbanor länkade (ej byggt ännu) |
| Per-hål-scener | Framtida uppgradering — dropar in i samma playlist-arkitektur |
| Feature Flags | Per game mode × input source, konfigurerbar runtime |
| Turnerings-grund | Tabell finns, UI ej byggt |

---

## Spelflöde (PLAY mode)

```
1. Ladda bana via ?course=CODE
2. startRound() → teleportToHole(0)
3. Swing Meter ELLER Launch Monitor → triggerRealShot(data)
4. physics.js beräknar bana → tracer ritar
5. Boll landar → nextShot() eller holeComplete()
6. holeComplete() → spara score → startNextHole()
7. startNextHole() → letar nästa hål med tee+flag
8. Inga fler hål → ROUND_COMPLETE
9. submitRoundResult() → POST /api/courses/:code/results
10. Leaderboard position visas på scorecard
```

---

## Kända Begränsningar / TODO

| Vad | Status |
|-----|--------|
| Stripe Premium (checkout + webhook) | ❌ Ej byggt (Fas 6) |
| Google OAuth | ❌ Ej byggt |
| "Make the Turn" (linked 9+9) | ❌ Ej byggt |
| Turnerings-UI | ❌ Ej byggt (tabell finns) |
| Builder Dashboard (analytics) | ❌ Ej byggt |
| Course Rating (1-5 stjärnor) | ❌ Ej byggt |
| Hub: Edit-knapp på egna publicerade banor | ❌ Ej byggt |
| Hub: Leaderboard-knapp på course-kort | ❌ Ej byggt |
| Premium upsell modal | ✅ Byggt (arcade-feature-flags.js) |
| Scorecard dynamiskt hålantal | ✅ Fixat (3, 5, 7, 9 hål fungerar) |
| Admin-lösenord hårdkodat | ⚠️ Bör bytas i produktion |

---

## Filstorlekar (referens)
- `arcade.html` — ~460 KB (monolith, gradvis modulariseras)
- `server.js` — ~25 KB
- `physics.js` — ~54 KB
- Moduler — 2-20 KB var

## Nyckelteknologi
- Three.js (3D-rendering, importerat via CDN)
- PostgreSQL (Railway-hostad)
- Express.js (backend)
- WebSocket (Launch Monitor-brygga)
- Vanilla JS (inga frameworks i frontend)

## Städning (2026-10)
Borttaget ur roten, finns kvar i git-historiken: gamla sidor (`arcade_clean`, `arcade_golden_backup_*`, `live_*`, `minigolf_backup`), engångsskript (`patch_*`, `fix_*`, `debug*`, `find*`, `check*`, `temp*`, `test_script_*`), `animate.js`, `count_lines.ps1` samt oanvända sprites/texturer/panoramabilder. `arcade.html` är fortfarande enda källan för bygg- och spelläget.

### Uppdelning av arcade.html (pågår)
Det stora inbyggda skriptet i `arcade.html` delas upp i egna filer, ett område i taget. Koden flyttas oförändrad och körs på exakt samma plats i ordningen (vanliga `<script src>`, så toppnivå-`let`/`const` delas fortfarande mellan filerna). Delfiler hittills: `arcade-biomes.js` (biom-data), `arcade-biome-tints.js` (trädtoner), `arcade-putt-odds.js` (Tour Pro-odds), `arcade-green-viz.js` (greenens rutnät/heatmap och breaklinje), `arcade-water.js` (vatten), `arcade-library.js` (3D-bibliotek, förinställningar, Poly.pizza), `arcade-rules.js` (mulligan, dropp, straffdropp), `arcade-save.js` (serialisera, spara, publicera, exportera), `arcade-load.js` (ladda bana, startmallar, import), `arcade-round-result.js` (rundresultat), `arcade-leaderboard.js` (topplista). Kvar i `arcade.html`: animate-loopen, spelflödet, skott, indatahanteringen, ångra/gör om och startblocket.
- Verktyg: `python3 tools/split-script.py cut NAMN.js --start ... --end ...` flyttar ett radintervall; `python3 tools/split-script.py verify origin/main` bevisar att allt lagt tillbaka är byte-identiskt med förra versionen.
- Skydd: `npm run smoke` (se `tests/README.md`) fångar saknade filer, nya sidfel och förlorade globaler.


## Green och tee följer marken efter sculpt (2026-10)
`studio-reanchor.js` (`window.reanchorStudiosAfterSculpt(preHeights)`), anropas från `finalizeSculptStroke` när ett höjdpenseldrag släpps.
- Green och tee lagras som "orörd mark (`origHeights`) + utplaning". Ett sculpt-drag ändrar den färdiga ytan, så att bara köra om pipelinen hade återställt gamla `origHeights` och raderat draget.
- Efter draget läggs höjdskillnaden (marken före draget sparas i `window._strokePreHeights` vid pointerdown) in i `origHeights`, `baseElevation` flyttas med medelskillnaden under ytan, och `applyGreenPipeline` / `applyTeePipeline(..., heightsOnly)` körs om. Resultat: platt yta på den nya marknivån, kullen finns kvar runt omkring.
- `origHeights` ersätts alltid med en NY array (undo-tillstånden pekar på den gamla), så ångra/gör om stämmer.
- Fairways: sculpt-draget bakas alltid in i fairwayns `origHeights`; pipelinen körs om bara om fairwayn redigerar höjder (vågor eller lutningstak). Bunkrar berörs inte än.

## Fairway: lutningstak (2026-10)
`fd.maxSlopePct` (0/saknas = av, 1–20 %, reglage "Max lutning" i Fairway Studio, flik Bredd & Terräng). `applyFairwayPipeline` kör efter vågorna `window.limitHeightSlope` ("thermal relaxation": grannhöjder får skilja högst tak × rutnätsavstånd, överskottet flyttas mellan dem, massan bevaras). Fri inne i fairwayn, tonar ut över rough-ringen, låst i greenzonen och utanför. En kulle blir alltså mjukare, inte bortgrävd. `window.fairwayEditsHeights(fd)` avgör om en fairway rör höjder (vågor eller tak). Sparas som `maxSlopePct`. Kostnad: ~80 ms för en normal fairway, ~0,4 s för en mycket stor (400 m).

## Fairway-reglage bygger först vid släpp (2026-10)
Reglagen Semi-rough, Rough och Max lutning (`sf-semirough-width`, `sf-rough-width`, `sf-max-slope`) flyttar under dragning bara knoppen och siffran (`oninput`). Själva ombygget (`updateLiveFairway`) och sparningen körs i `onchange`, alltså när man släpper. Tidigare byggdes hela pipelinen vid varje pixel och knoppen släpade. `window._sfDrag` (id på reglaget som dras) hindrar `FairwayStudio.syncUIValues` från att flytta tillbaka knoppen eller siffran under dragningen. Rough-reglaget har två lyssnare (inline-attribut i `arcade.html` och `addEventListener` längre ned); bara det inbyggda `onchange` bygger.

## Berg-spline: öppen linje, magnet, ingen korsning (2026-10)
Kulle (MTN → Hill) ritas som green/fairway: bollarna är stora (0,85 m, växer med formens storlek, första 1,4×) och linjen är öppen (ljusare) tills formen stängs. En stängning sker genom att klicka nära första bollen eller på den (`window.closeMountainShape`, flaggan `window._mtnClosed`); en stängd form tar inga fler punkter, en boll som tas bort med högerklick (på bollen eller sista punkten) öppnar formen igen. Bygg fungerar även utan stängning (bygget stänger själv, förhandsvisningen av yta och höjdstav räknas alltid på den stängda formen). Korsning stoppas för kulle och bergsrygg: ny punkt (`polylineSelfIntersects` på öppen kedja), drag av boll (`moveWouldCross`) och byggknapparna (`validateSmartShape` / öppen kontroll för ryggen). Rund kulle som dras ut (`hillDrag`) är direkt stängd. Byggknapparna och magneten kontrollerar även den utjämnade kurvan (`window.mtnOutlineCrosses`, samma provtagning som bygget), eftersom kontrollbollarna kan vara korsningsfria medan Catmull-Rom-kurvan mellan skarpa svängar slingrar sig över sig själv. Smoke-testet klickar i `MTN` med kameran rakt uppifrån.

## Exakt förhandsvisning av berget (2026-10)
Kullens höjder räknas av en ren funktion, `window.mtnHillField(points, height, jagMul, {stride})` (`smart-builder.js`), som inte skriver till terrängen. `executeSplineMountain` skriver dess `newH` till marken, och förhandsvisningen (`buildHillMesh` i `arcade.html`) ritar samma värden som en genomskinlig 3D-yta 0,15 m över marken, färgad efter lutning över cirka 4 m (grönt ≤ ~30°, gult till 45°, rött över). Bara celler där marken faktiskt höjs (> 3 cm) ritas, så ytan visar var berget börjar. Under ritning/reglage ritas ett glest nät (~6 000 celler) direkt och fullt nät (≤ 90 000) 180 ms efter sista ändringen. Rutan "Visa som nät" (`window._mtnPreviewWire`) visar trådnät. Smoke-testet jämför varje vertex mellan förhandsvisning och bygge.

## Planerarens "gula läge" (2026-10)
`HoleGenerator.scoreSite/evaluateSite` har `env.allowShaping` (satt av kartplaneraren `blueprint.js`; slumpa hål är fortsatt strikt). En plats som den strikta kontrollen (`SLOPE`) avvisar men som ryms inom `HoleGenerator.SHAPE` blir **gul**: `ev.ok === true`, `ev.shaped` (['green','tee','fairway']) och `ev.work` (green/tee: största höjdändring i m = `cutDepth`, fairway: lutningstak i %). Gränser: green ≤ 3 m, tee ≤ 2,5 m, fairway ≤ 30 % lutning (soft 18 %). Därutöver förblir platsen röd.
Vid bygge (`generate` med `placement`) formas marken: fairwayn skapas med `maxSlopePct` = `SHAPE.fairway.cap` (10 %), greenens `blendDistance` blir max(8, 4 × cut) (högst 15 m), tee-boxarnas `blendRadius` på samma sätt. Kartan visar gult (⚠️ i hålchippen, gul status med vad som sker), Bygg-knappen är aktiv.
