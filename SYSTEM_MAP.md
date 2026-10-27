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
| `arcade-aim.js` | Sikte: bäring, vridning, tap vs drag (ren matte, `window.AimMath`) |
| `arcade-flight-cam.js` | Flygkamera: tee-kamera med zoom, bana till landningsvy från apex, slow motion (ren, `window.FlightCam`) |
| `arcade-shot-plan.js` | Slagplan: klubb och kraft till siktpunkten, vind- och terrängeffekt (sökning, `window.ShotPlan`) |
| `arcade-feature-flags.js` | Free/Premium feature gating |
| `arcade-api-service.js` | Centraliserat HTTP API-lager med auth headers |
| `arcade-storage-service.js` | localStorage-abstraktion (drafts, compressed levels) |
| `arcade-surface.js` | Underlagsklassificering (pixel → GREEN/FAIRWAY/…), delas av `localGetTerrainAt` (lie) och `physicsTerrainAt` (bollfysik); snö ändrar aldrig underlaget |
| `gspro-bridge/protocol.js` | GSPro Open Connect-protokollet utan nätverk: ramning av TCP-strömmen, normalisering av slag (BackSpin/SideSpin, heartbeat), kvitton; används av `gspro-bridge/bridge.js` |
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
| `POST /api/auth/register` | POST | Skapa/hämta user via device_id (kräver enhetens token om kontot har en; svaret har aldrig `token_hash`) |
| `GET /api/users/:id` | GET | Hämta profil |
| `PUT /api/users/:id` | PUT | Uppdatera display_name (kräver auth) |
| `GET /api/users/:id/handicap` | GET | Handicapindex och senaste rundor |

### Courses
| Endpoint | Metod | Syfte |
|----------|-------|-------|
| `GET /api/courses` | GET | Lista publicerade banor (exkl. draft, range, hidden) |
| `POST /api/courses` | POST | Spara/uppdatera bana (kräver id, 401 annars; med ownership-check) |
| `GET /api/courses/:code` | GET | Ladda en bana |
| `POST /api/courses/:code/like` | POST | Gilla en bana |

### Collections (banor av flera 3-hålsplattor)
| Endpoint | Metod | Syfte |
|----------|-------|-------|
| `GET /api/collections` | GET | Lista samlingar (`is_mine`, aldrig `owner_id`) |
| `GET /api/collections/:id` | GET | En samling; `plate_versions` ger varje plattas nuvarande `version` |
| `POST /api/collections` | POST | Spara/uppdatera (en samling med ägare ändras bara av ägaren: utan id 401, annat id 403; utan id 401 också för en ny samling; äldre ägarlösa samlingar kan ändras av vem som helst; plattlistan kontrolleras; `expect_existing: true` ger 404 om samlingen raderats) |
| `GET /api/collections/:id/leaderboard` | GET | Ett varv över alla plattor räknas ihop |
| `DELETE /api/collections/:id` | DELETE | Radera (ägaren; en äldre samling utan ägare, sparad innan id krävdes, kan raderas av vem som helst som skickar ett id) |

### Leaderboard
| Endpoint | Metod | Syfte |
|----------|-------|-------|
| `POST /api/courses/:code/results` | POST | Spara rundresultat + sanity check + builder score |
| `GET /api/courses/:code/leaderboard` | GET | Hämta topplista (?mode=LAUNCH_MONITOR&period=month) |

### Ranges
| Endpoint | Metod | Syfte |
|----------|-------|-------|
| `GET /api/ranges` | GET | Lista publicerade ranges |

### Assets & Biomes (admin, lösenord från ADMIN_PASSWORD)
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
- **Bunkrar (2026-10):** bunkrar är också "orörd mark + urgrävning". Draget bakas in i `bunker.origHeights` (ny array, gamla lämnas för undo) och `applyBunkerPipeline` körs om för bunkrar nära draget, samt för alla bunkrar med ändrad bbox på ett hål där green/tee/fairway kördes om (de nollställer marken runt sig, inklusive bunkerns grop). Utan detta fick en kulle runt green gamla markhöjder tillbaka vid nästa bunkerredigering. Bake-only-läget (vatten, berg, stamp) bakar in i fairway och bunker utan omkörning.

## Fairway: lutningstak (2026-10)
`fd.maxSlopePct` (0/saknas = av, 1–20 %, reglage "Max lutning" i Fairway Studio, flik Bredd & Terräng). `applyFairwayPipeline` kör efter vågorna `window.limitHeightSlope` ("thermal relaxation": grannhöjder får skilja högst tak × rutnätsavstånd, överskottet flyttas mellan dem, massan bevaras). Fri inne i fairwayn, tonar ut över rough-ringen, låst i greenzonen och utanför. En kulle blir alltså mjukare, inte bortgrävd. `window.fairwayEditsHeights(fd)` avgör om en fairway rör höjder (vågor eller tak). Sparas som `maxSlopePct`. Kostnad: ~80 ms för en normal fairway, ~0,4 s för en mycket stor (400 m).

## Fairway-reglage bygger först vid släpp (2026-10)
Reglagen Semi-rough, Rough och Max lutning (`sf-semirough-width`, `sf-rough-width`, `sf-max-slope`) flyttar under dragning bara knoppen och siffran (`oninput`). Själva ombygget (`updateLiveFairway`) och sparningen körs i `onchange`, alltså när man släpper. Tidigare byggdes hela pipelinen vid varje pixel och knoppen släpade. `window._sfDrag` (id på reglaget som dras) hindrar `FairwayStudio.syncUIValues` från att flytta tillbaka knoppen eller siffran under dragningen. Rough-reglaget har två lyssnare (inline-attribut i `arcade.html` och `addEventListener` längre ned); bara det inbyggda `onchange` bygger.

## Fairway: lutningstak längs och tvärs (2026-10)
Två tak: `fd.maxSlopePct` = tvärs (sidolutning; på banor sparade före uppdelningen det enda taket) och `fd.maxSlopeAlongPct` = längs spelriktningen (uppför/nedför, 0 = samma som tvärs). Reglagen "Max lutning tvärs (sidled)" (`sf-max-slope`) och "Max lutning längs" (`sf-max-along`) i Fairway Studio, flik Bredd & Terräng; tips 6 % tvärs / 15 % längs. `limitHeightSlope(..., aniso)` begränsar gradienten till en ellips `(längs/taklängs)² + (tvärs/taktvärs)² ≤ 1` med en spelriktning per vertex (`aniso.tx/tz`); utan `aniso` (eller med lika tak) är det exakt det gamla enkla taket. Spelriktningen kommer från `window.fairwayAxisField(hole, fd)`: linjen tee → målpunkt → green (en dogleg följer svängen, 15 m mjuk övergång vid knäcken), annars konturens huvudaxel; riktningen är utan tecken (uppför och nedför behandlas lika). Begränsning: taket kan bara släta en lokal kulle. En jämn lutning över hela fairwayn går inte att ändra, eftersom konturen är låst mot marken runt den. Planerarens gula läge bygger fortfarande med ett enda tak (`SHAPE.fairway.cap`), `_fairwayMaxSlopeAlongPct` nollställs under bygget som `_fairwayMaxSlopePct`.

En ny fairway som byggs för hand startar alltid med båda taken av (0), oavsett vad reglagen höll från förra fairwayn; bygget rör bara marken om byggaren själv drar upp ett tak. Den orange varningen när taket inte nås säger att marken är för brant och pekar på Platta till/Ramp, att flytta fairwayn eller att stänga av taket.

## Berg-spline: öppen linje, magnet, ingen korsning (2026-10)
Kulle (MTN → Hill) ritas som green/fairway: bollarna är stora (0,85 m, växer med formens storlek, första 1,4×) och linjen är öppen (ljusare) tills formen stängs. En stängning sker genom att klicka nära första bollen eller på den (`window.closeMountainShape`, flaggan `window._mtnClosed`); en stängd form tar inga fler punkter, en boll som tas bort med högerklick (på bollen eller sista punkten) öppnar formen igen. Bygg fungerar även utan stängning (bygget stänger själv, förhandsvisningen av yta och höjdstav räknas alltid på den stängda formen). Korsning stoppas för kulle och bergsrygg: ny punkt (`polylineSelfIntersects` på öppen kedja), drag av boll (`moveWouldCross`) och byggknapparna (`validateSmartShape` / öppen kontroll för ryggen). Rund kulle som dras ut (`hillDrag`) är direkt stängd. Byggknapparna och magneten kontrollerar även den utjämnade kurvan (`window.mtnOutlineCrosses`, samma provtagning som bygget), eftersom kontrollbollarna kan vara korsningsfria medan Catmull-Rom-kurvan mellan skarpa svängar slingrar sig över sig själv. Smoke-testet klickar i `MTN` med kameran rakt uppifrån.

## Exakt förhandsvisning av berget (2026-10)
Kullens höjder räknas av en ren funktion, `window.mtnHillField(points, height, jagMul, {stride})` (`smart-builder.js`), som inte skriver till terrängen. `executeSplineMountain` skriver dess `newH` till marken, och förhandsvisningen (`buildHillMesh` i `arcade.html`) ritar samma värden som en genomskinlig 3D-yta 0,15 m över marken, färgad efter lutning över cirka 4 m (grönt ≤ ~30°, gult till 45°, rött över). Bara celler där marken faktiskt höjs (> 3 cm) ritas, så ytan visar var berget börjar. Under ritning/reglage ritas ett glest nät (~6 000 celler) direkt och fullt nät (≤ 90 000) 180 ms efter sista ändringen. Rutan "Visa som nät" (`window._mtnPreviewWire`) visar trådnät. Smoke-testet jämför varje vertex mellan förhandsvisning och bygge.

## Planerarens "gula läge" (2026-10)
`HoleGenerator.scoreSite/evaluateSite` har `env.allowShaping` (satt av kartplaneraren `blueprint.js`; slumpa hål är fortsatt strikt). En plats som den strikta kontrollen (`SLOPE`) avvisar men som ryms inom `HoleGenerator.SHAPE` blir **gul**: `ev.ok === true`, `ev.shaped` (['green','tee','fairway']) och `ev.work` (green/tee: största höjdändring i m = `cutDepth`, fairway: lutningstak i %). Gränser: green ≤ 3 m, tee ≤ 2,5 m, fairway ≤ 30 % lutning (soft 18 %). Därutöver förblir platsen röd.
Vid bygge (`generate` med `placement`) formas marken: fairwayn skapas med `maxSlopePct` = `SHAPE.fairway.cap` (10 %), greenens `blendDistance` blir max(8, 4 × cut) (högst 15 m), tee-boxarnas `blendRadius` på samma sätt. Kartan visar gult (⚠️ i hålchippen, gul status med vad som sker), Bygg-knappen är aktiv.

## Sparade och publicerade banor (2026-10)
Tre sorters sparad bana, alla med samma post på servern (`courses`) när de väl finns där:
- **Snabbutkast** (på enheten): `saveLevel` skriver hela banan till IndexedDB (`ArcadeStorage.saveFullDraft('quick_draft')`) och en liten metapost till `localStorage.arcade_custom_level`. Posten kommer ihåg vilken serverbana den hör till (`edit_code`, `edit_is_published`), banans namn och författare, så Publicera uppdaterar den banan i stället för att göra en kopia. **Start-sparningar hålls tillbaka:** `saveLevel` gör ingenting medan `window._courseLoading` är satt (sätts av `arcade-save.js`, släpps av `loadLevel` när den är klar; `loadLevel` startas av `arcade.html` när enhets-id:t är klart, senast efter 8 s, och ingen timer släpper flaggan). Annars skrev start-koden (`updateSurroundColors`, `removePanorama`) över utkastet med en tom bana innan `loadLevel` hunnit läsa det.
- **Utkast på servern**: `publishCourse({isDraft:true})` (`smartSaveDraft`). Sparar du igen uppdateras samma post. Listan "Mina utkast" hämtas från `GET /api/my/courses` och lagras även i `localStorage.golf_os_my_drafts` (som hubben och banlistan läser).
- **Publicerad bana**: `publishCourse({isDraft:false})` uppdaterar posten banan redan har (utkast blir publicerat, redan publicerad får ny `version`, servern bumpar bara när den var publicerad). `holes` har bara det som spelas; byggarens egna definitioner (green, fairway, bunkrar, tee-boxar) ligger i `builder_holes` och skickas bara till ägaren (`can_edit`). "Spara utkast" döljs för en publicerad bana (`smartSaveDraft` stoppar den också) så att den aldrig tas offline; "Spara och spela" arbetar mot en separat spelkopia (`theme_data._playCopy`) som inte syns i listorna.
Adressen i byggaren förblir `?autorun=edit_build&edit=KOD` efter sparning. Test: `npm run e2e` (`tests/e2e/courses-e2e.js`).

## Röstkommandon i buildern (2026-10)
`voice-commands.js` (laddas efter `smart-builder.js`). Mikrofonknappen (nere till höger, syns bara i byggläget) startar webbläsarens taligenkänning (`SpeechRecognition`, sv-SE eller en-US, chippet SV/EN byter och minns valet i `golf_voice_lang`). Texten blir ett kommando med `parse()` (ren funktion, testad i `tests/test_voice_commands.js`; båda språken förstås oavsett igenkänningsspråk) och kör det som knappen gör: `selectHoleComponent` (green, fairway, bunker, tee), `setTool` (markera, forma, måla, vatten, objekt, miljö, hålverktyg), `performUndo`/`performRedo`, `changeHole` (nästa/föregående hål), `saveQuickDraft` (spara) och `saveAndPlay` (bara hela frasen "spara och spela" / "save and play"). Lyssnandet startar om när webbläsaren avslutar en session, stängs av efter 90 s utan kommando, vid blockerad mikrofon och när man lämnar byggläget. Nya kommandon läggs i `RULES` (mest specifika först). Webbläsare utan `SpeechRecognition` (Firefox) får ingen knapp.

## 3D-gräset: skal, semi-rough och kantviktning (2026-10)
`terrain-shells.js`: gräset är 3/5/8 skal (LOW/MED/HIGH) ovanpå terrängen. Masken (`rebuildRoughMask`) har R=rough, G=deep rough, B=semi-rough; fairway, green och sand får inget gräs. Höjder (m): semi-rough 0,12 (40 % av rough-reglaget), rough 0,30, deep rough 0,60. De är överdrivna med flit: med verkliga höjder (4-8 cm) syns inga skal på spelavstånd (provat). Fragment-shadern måste ha alla uniforms den läser (`uLayers` saknades en gång: shadern kompilerade inte, inget gräs ritades och ingen sidfel kom; smoke-testet "3D grass shells compile" fångar det).
Sculpt: medan en penseldrag pågår följer 3D-gräset marken via `queueRegionSync` (bara höjder, bara det rörda området, högst ca 12 gånger/s, anropas efter `syncDirtyPositions` i sculpt-loopen och i RAMP). Förut hölls skalen kvar tills man släppte, så gräset sjönk ner i en höjd som växte. Normaler och en full omsampling sker som förut vid släpp (`finalizeSculptStroke`).

Grästextur på deep rough (av som standard, `?grasstex=1` eller `=2` (andra tilen, `grass-tile-2.jpg`, finare och mer upprättstående blad) slår på och minns, `?grasstex=0` stänger av; kreditering i `CREDITS.md`): `grass-tile.jpg` (mönster 1: 1024², gråskala, sömlös tile gjord av en mjuk tecknad gräsbild uppifrån med blad och små strån, kontrast 0,13, ca 285 KB; laddas som `grass-tile.jpg?v=4`, höj versionen vid nästa byte) laddas av `setGrassTex` och multipliceras som ljus/mörker på biomens färg i skalshadern, bara för deep rough, i två skalor (den andra roterad) så att tile-upprepningen inte syns. Mipmaps tonar ut den på avstånd. Ingen höjd eller siluett, bara yta. Kontrollera att bildens licens tillåter publicering.

Kantviktning (på som standard på telefon och surfplatta, av på dator; `?grassedge=1` slår på och minns, `?grassedge=0` stänger av): `setEdgeMapFromMask` (hoppas över medan både kantfunktionerna är av, byggs vid påslag) bygger en 1024×1024 "närhet till kant"-karta (1 vid kant mot fairway/green/sand, 0 några meter in, `edgeWidth` 5,5 m). Långt inne i gräset ritas bara de nedre skalen (`_isInteriorLayer`: skal 1, plus ett mittskal på MED/HIGH), nära kant alla; en dither gör övergången mjuk. De övre skalen får dessutom bara geometri i kantremsan (`_buildStrip`: ett eget index över samma hörn, bara rutor med gräs vid en kant, plus en ruta marginal), så trianglarna minskar och inte bara pixlarna (i smoke-testets fairway-ruta 2 000 av 80 000 trianglar per övre skal). Bildtid på riktig mobil är ännu inte mätt.

Mobil och iPad: iPadOS 13+ säger att den är en Mac ("Macintosh") i user agent. Alla mobilkontroller som gäller gräs och upplösning räknar därför också "Macintosh med pekskärm" (`navigator.maxTouchPoints > 1`) som mobil: `window.isTouchDevice()` i arcade.html (används av `getCapPixelRatio` och `initAutoPerformanceLOD`), `_isMobile` i `terrain-shells.js` och vid `TERRAIN_SEGS`. Förut fick en iPad datorns upplösningsfaktor 2,0, inget automatiskt LOW-gräs och 9999 m ritavstånd på HIGH.

Brus i skalshadern: gräsmönstret (`fbm` + `vnoise`, fem brusanrop per pixel och skal) läser en bakad, sömlös 256×256-textur (`makeNoiseTex`, samma utjämnade värdebrus, period 32 brusenheter) i stället för fyra `sin`-hashar per anrop. Ingen mipmap: medelvärdet av brus är 0,5, och då skulle skalen på avstånd bli heltäckande skivor. Utseendet jämfört före/efter i en render: samma mönster.

Vind i gräset: skalen och kantstråna följer spelets vind (`currentWindMph`, `currentWindDir`, medvind = (sin, -cos) som träd och löv). `WIND_GLSL` (`windLean`) ger vindbyar som rullar över gräset (vågor på 35 och 90 m) plus en grundlutning. Skalen flyttas inte: fragment-shadern hämtar mönstret från lovart, mer ju högre skalet är (`vSway * targetH * eL²`), så stråna lutar och roten står still. Kantstråna böjs i vertexshadern (kvadratiskt från roten, toppen sjunker lite). Styrka `0,12 + 0,68 × min(1, mph/35)`: en svag bris även i stiltje. Wind Sway-reglaget (samma som träden) och `prefers-reduced-motion` stänger av den.

## Kantstrån: riktiga strån längs gräsets kanter (2026-10, av som standard)
`terrain-shells.js`, `_buildBlades`: längs varje gräns mellan skalgräs och fairway/green/sand (klasskartan 1024×1024 som också ger kantkartan) står riktiga, avsmalnande strån, ett instansierat blad (7 hörn, 5 trianglar) med egen shader. HIGH/MED/LOW: 10/6/3 strån per gränscell (cellen är 0,59 m) och ritavstånd 120/70/40 m. Stråna grupperas i 48 m-bitar som kullas och göms på avstånd; slumpen är deterministisk per cell, så stråna ligger kvar när masken byggs om. Höjd = rough/deep/semi-höjden × 0,75-1,25; rötterna följer terrängen (`getTerrainHeight`, uppdateras 300 ms efter att marken ändrats i `syncHeights`). Bredden vid roten är 2,5 cm (överdriven med flit, ett verkligt strå är några mm). Av som standard: `?grassblades=1` slår på och minns, `?grassblades=0` stänger av. Provat i swiftshader: ungefär +50-150 ms bildtid med 2 800 strån, vilket inte säger något om en riktig GPU; på en riktig bana kan det bli tiotusentals strån, så mät på mobil innan det blir standard.

## 2D-gräs: tuvor på korsade kort runt kameran (2026-10, av som standard)
`terrain-shells.js`, `_updateCards` / `_buildCardChunk`: grästuvor som två korsade, platta kort med en bild av 8-13 strån. Bilden (`makeCardAtlas`) ritas av koden vid start, ingen fil: fyra tuvor i en 1024×256-atlas, avsmalnande böjda strån, mörka vid roten och ljusa i toppen. Skuggningen (röd kanal) och täckningen (alfa) målas på två canvasar och packas i en `DataTexture`, eftersom en canvas sparar förmultiplicerad färg och kanterna då blev för ljusa. Färgen kommer från biomen i shadern (rough, deep, semi), så tuvorna passar marken i alla årstider; långt ut tonar de in i grästonen och dithras bort. Shadern skriver alfa 1 och klipper vid 0,5: canvasen är genomskinlig (`alpha: true`), så mjuk alfa (alpha-to-coverage provades) lät sidan lysa igenom stråkanterna.
Placering: från klasskartan (samma som kantstråna, byggs när korten slås på), i 16 m-bitar inom räckvidden från kameran, högst två nya bitar per bild (närmast först), bitar bakom kameran släpps. Slumpen är deterministisk per bit, så en bit som byggs om ser likadan ut. LOW/MED/HIGH: räckvidd 20/32/50 m (telefon och iPad 70 %), 1,2/2,0/3,5 kort per m² gräs; ungefär 16 000 kort på HIGH i en ruta där halva marken är gräs. Rötterna från `getTerrainHeight`; när marken ändras, masken byggs om, kvaliteten eller höjdreglagen ändras släpps alla bitar och byggs om runt kameran. Bitarna delar mallens `position`/`uv`: `_dropCardChunk` tar bort dem före `dispose()` (samma fälla som kantremsan). Vinden är densamma som skalens (`windLean`).
Av som standard: `?grasscards=1` slår på och minns (`golf_grass_cards`), `?grasscards=0` stänger av; knappar i gräsmenyn (2D-gräs). Bildtiden på riktig telefon är inte mätt.

## Dialoger i #ui-layer tar emot klick själva
`#ui-layer` har `pointer-events: none`, och barn ärver det. En helskärmsdialog som ligger i den måste ha `pointer-events: auto` på sig själv, annars faller klicken igenom till canvasen och knapparna är döda. Det drabbade vattenhindrets dialog (`#penalty-decision-modal`, REHIT / LATERAL DROP) och publiceringsgalleriet (`#gallery-modal`). Röktestet kontrollerar att knapparna i båda nås av `elementFromPoint`.

Gräsmeny (Environment > 3D Grass): under höjdreglagen finns knappar för extralägena (kantlager, kantstrån, 2D-gräs, gräsmönster av/1/2). `setGrassExtra(kind, v)` i arcade.html slår på läget i `_terrainShells` och sparar samma localStorage-nyckel som `?grassedge` / `?grassblades` / `?grasscards` / `?grasstex`; `syncGrassExtraUI()` visar aktuellt läge. Knapparna syns bara när 3D-gräset inte är OFF.

Kantremsans geometri (`_stripGeo`) delar vertex-attribut med `customGeo`. Den får inte `dispose()`-as som den är: renderern raderar då GPU-buffertarna för alla attribut, även de delade, och helrutnätsskalen ritade vidare från en gammal buffert (gräset följde inte sculpt efter en sidladdning). `_disposeStrip()` tar först bort attributen så att bara remsans eget index frigörs.

## Säsong och väder (new_course.html -> bygget) (2026-10)
Steg 3 på nysidan ("Säsong & atmosfär") väljer **biom**, inte väder: `GLOBAL`, `AUTUMN`, `WINTER`, `DESERT`, `DESERT_AUTUMN`, `DESERT_WINTER` skickas som `season`/`biome`, bygget läser `season` som biom (`arcade-load.js`) och `changeBiome` byter palett, trädfärg, partiklar (`ParticleEngine.activateBiome`), 3D-löv (bara `AUTUMN`) och ljudmiljö. Väder är ett eget lager (`ParticleEngine.setWeather`: CLEAR, OVERCAST, DRIZZLE, RAIN, STORM, FOG) som väljs i byggaren och sparas som `theme_data.weatherMode`; det börjar alltid som CLEAR. Winter ritar inga regnstrimmor (bara dimman och mörkret).
`activateBiome` letar först exakt träff, sedan `DESERT*` -> sanddamm (ökenhöst och ökenvinter fick förut löv respektive snö av namnmatchningen), sedan delsträng. `OVERCAST` har ett eget preset (dimma x1,1, ljus x0,85, inga partiklar) i stället för `null`, som var samma sak som CLEAR. Smoke-testet "seasons and weather" kontrollerar båda.
Känt och inte åtgärdat: `changeBiome` anropar `window.applySnowLayer`, men funktionen finns bara som `terrainAutoPaint.applySnowLayer`, så snölagret på marken läggs aldrig på i Winter. Det är med flit inte kopplat: `removeSnowLayer` återställer hela canvasen från en ögonblicksbild och skulle radera målning som gjorts efter snön. Väderljusets dämpning börjar från ljuset för aktuell timme (`_applyWeatherAtmosphere` kör `setTimeOfDay` först), men skrivs över när tiden på dygnet ändras efteråt (dimman består), och tiden på dygnet sparas inte i banan.

## Varmt solljus (2026-10)
Dagsljuset har en svag gul ton i sommarvärldarna så att samma palett läses som friskare och mer lime (bildreferens: ytorna är 15-25° gulare än paletten). Paletten och därmed ytdetekteringen och gräsmaskerna är orörda; det är ljusets färg som ändras. `arcade-scene-engine.js`: `SUN_TINT` (sol 255/238/200, omgivningsljus 255/249/232) multipliceras in i `setTimeOfDay`, viktat med `getSunWarmth()` (biomen: GLOBAL 1, AUTUMN och DESERT 0,5, DESERT_AUTUMN och det gamla namnet DESERT_SUNSET 0,3, allt annat 0, alltså Vinter och Månen vita) och med solens styrka (1 vid middagssolens `dirInt`, 0 vid nattens: nattpresetens ljus är inte 0, så styrkan mäts från den golvnivån och nattens blå månljus blir exakt oförändrat). `refreshSunLight()` flyttar bara ljusfärgerna (inte himmel, dimma eller styrka) och körs av `changeBiome` och när en sparad bana läser sin biom. Mätt i en render: fairway går från nyans 95° till 88° (`#85C557` till `#85BB49`), himlen (en gradient) påverkas inte. Vill man ha mer eller mindre: ändra `SUN_TINT`. Smoke-testet "warm sun" kontrollerar sommar, vinter, byte av biom och natt.

## Sommarpaletten (GLOBAL) (2026-10)
Green `#8ACF72`, Foregreen `#9ACB67`, Fairway `#79B84F`, Semi-rough `#659A3F`, Rough `#4C7D32`, Deep rough `#315B2B` (tee oförändrad `#7cb54c`). Avstånden mellan grannfärgerna är 20, 45, 39, 40 och 44 (förut 20, 21, 39, 53, 55) och ljusstegen är jämnare. Palettens enda riktiga källa är `arcade-biomes.js` (`CLOUD_BIOMES.GLOBAL`) och startvärdet `CURRENT_BIOME_CONFIG` i `arcade.html`; resten (reservvärden efter `||`, swatcharna i menyerna, adminsidans färgväljare) har samma värden. **Databasens `biomes`-tabell skriver över de inbyggda paletterna** (`fetchCloudBiomes`): finns en GLOBAL-rad där gäller den, och den måste uppdateras på adminsidan. Sparade banor bär sin egen palett i `theme_data.config` och behåller sina färger. Smoke-testets fasta green-färg byttes mot banans egen (`CURRENT_BIOME_CONFIG.greenColor`).

## Adminsidans teman och databasrader (2026-10)
`window.BUILTIN_BIOMES` (`arcade-biomes.js`) är en kopia av de inbyggda paletterna. En rad i databasens `biomes`-tabell ersätter hela paletten (`fetchCloudBiomes`), och adminsidan sparade förut bara 12 av de 14 färgerna (inte `oceanColor` och `horizonColor`), så `changeBiome` tog de saknade från biomen som var aktiv innan: horisonten och havet från Höst låg kvar efter ett byte tillbaka till Sommar. Nu fyller `changeBiome` i det raden saknar från den inbyggda paletten med samma namn. Adminsidan (`admin_assets.html`) laddar `arcade-biomes.js`, visar den inbyggda paletten för en biom som inte har någon rad (förut sommarens färger, som en Spara kunde skriva över t.ex. Höst med), har väljare för hav och horisont, sparar nycklar den inte redigerar oförändrade, och temalistan har `WINTER`, `DESERT_AUTUMN` och `DESERT_WINTER` (spelet och nysidan använder dem; `SNOW` är kvar som gammalt namn). `tests/test_biome_palettes.js` (körs av `npm test`) låser att adminsidan har en väljare per färg som börjar på GLOBAL och att listan har spelets id; smoke-testet "biome rows" kontrollerar läckan.

## GLB-kontroll (glb-check.js)

Läser en `.glb` utan beroenden och säger vad modellen kostar i spelet. Samma modul används på två ställen:
- **Kommandorad:** `node tools/check-glb.js [--kind tree|plant|rock|landscape|prop] [--instances N] [--json] fil.glb|mapp ...` (exitkod 1 om någon modell får FEL, så den kan stå i ett batch-skript efter Meshy-exporten).
- **Texturminne per biom:** `GlbCheck.check(...).facts.gpuMB` är de utpackade texturerna (bredd x höjd x 4 byte x 1,34 för mipmaps) som spelet faktiskt laddar upp. Admin sparar värdet i tillgångens `config.gpuMB`, och biomstapeln i biblioteket summerar Global + vald biom mot `GlbCheck.TOTAL_GPU_BUDGET_MB` (128 MB, ett förslag som inte är uppmätt på en telefon). Modeller sparade före ändringen saknar värdet och räknas som okända (en rad under stapeln säger hur många).
- **Admin (`admin_assets.html`):** rapportpanelen under filväljaren. Underkategorin (`KIND_OF_SUBCAT`: TREES→tree, PLANTS→plant, ROCKS→rock, LANDSCAPE→landscape, BLOCKS→prop) väljer budget; vid FEL frågar "Publicera"-knappen först. Webbläsaren avkodar texturerna (`sampleImage`) så färgkontrollen också körs; i Node hoppas den över.

Måtten följer `arcade.html`: spelet skalar på höjd, centrerar i x/z och sätter basen på marken (så pivot och skala är inga fel), varje mesh blir en `InstancedMesh` utan frustum-culling (trianglar x utplacerade exemplar är den verkliga kostnaden), metall/råhets-kartor kastas bort, Meshopt och KTX2 finns inte (FEL om de krävs), och färgskuggaren delar texlarna i lövverk/stam/snö. Budgetarna i `PROFILES` är förslag, justera dem där. Trianglar, hörn och mått är verifierade mot three.js GLTFLoader för de fyra modellerna i repot. Test: `tests/test_glb_check.js`.

## Träffyta anpassad efter modellen (hitbox-fit.js, prop-collision.js)

Förut hade ett träd en stamradie och en kronradie, för hand i admin. Nu kan en tillgång ha fysiken `type: "profile"`: modellen delas i 12 höjdskikt och varje skikt är den minsta cirkel som rymmer modellen i skiktet (radie `r` runt `cx, cz`), så en kon, ett paraply eller en krona som hänger åt ena hållet följs. Dessutom en stam (`trunk`: radie, mitt, höjd): en hård cylinder som bollen studsar mot. Alla mått är i meter för modellen i skala 1, i samma ram som spelet placerar modellen i (skalad till `targetHeight`, centrerad i x och z på boxens mitt, basen på marken); ett utplacerat objekt är den ramen gånger sin skala, vriden runt y med sin rotation (lutning och roll följs inte).

- **`hitbox-fit.js`** (Node och webbläsare): `fit(mesh, {targetHeight, bbox})` klipper varje triangel mot varje skikt den går genom (så en stor plan facett räknas i alla skikt), tar minsta omslutande cirkel per skikt (Welzl på konvexa höljet) och hittar stammen: de smala skikten (under 40 % av det bredaste, aldrig högre än 60 % av höjden) från marken, med medianen av deras radier. Utan tydlig stam (kon, buske) blir stammen en gissad stav (12 % av största radien, 40 % av höjden, `guessed: true`). `hit(profil, skala, rot, ox, oz, bx, bz, z)` ger `null`, `TRUNK` (med normal och säker plats) eller `CANOPY` (kronan: ovanför stammens topp, inom skiktets cirkel). `scale(profil, k)` skalar alla mått.
- **`prop-collision.js`**: `window.propHitAt(obj, x, z, höjd)`, testet som skottfysiken (`checkCollisionCallback` i arcade.html) ropar för varje utplacerat objekt. Sfär, cylinder och träd (en stam + en krona) är oförändrade; `profile` använder hitbox-fit.js och ger samma svar (`part: 'TRUNK'` med `n` och `safePos`, eller `part: 'CANOPY'`).
- **Adminsidan:** formen "Profile (fitted to the model)", knappen "Fit collision shape to the model" och en automatisk anpassning när en ny GLB laddas upp som TREES. Trådramen visar skikten (röda) och stammen (gula). Profilen sparas i unit-höjd i minnet och skalas till `targetHeight` vid ritning och vid publicering; en sparad profil läses tillbaka när tillgången öppnas. Spelet skalar profilen vid "Spara som standard" (`savePropAsDefault`). `hole-generator.js` räknar profilens stam som fotavtrycket, som för ett träd.
- **Kommandorad:** `node tools/fit-hitbox.js [--height 15] [--json] fil.glb` skriver ut profilen (`tools/glb-mesh.js` läser trianglarna ur GLB:n; inte för Draco).
- **Test:** `tests/test_hitbox_fit.js` (syntetiska träd, rotation mot three.js, skala, modellerna i repot, propHitAt) och en rökkontroll i `tests/smoke/arcade-smoke.js` som skjuter in i en profilstam med den riktiga skottfysiken.

Begränsningar: en cirkel per skikt, så en lång ensidig krona blir en stor cirkel (nästa steg vore en ellips eller kontur per skikt); kronan saktar ner bollen via den befintliga `CANOPY`-grenen i `physics.js`, som reagerar på delen (`part`) och alltså gäller alla träd, även egna tillgångar.

## Putt-fysiken (physics.js)

- **Rullmotstånd:** på green en konstant retardation från stimp (Werner & Greig, `greenMu`: 0,056 vid stimp 10 = 0,55 m/s²). En putt med 1,83 m/s rullar stimp fot. Grain är en liten fast kraft (0,03 m/s² vid stimp 10, riktning efter plats).
- **Lutning:** en rullande boll får `ROLLING_SLOPE_FACTOR` = 5/7 av tyngden längs lutningen (en del av energin går åt till att snurra bollen); en glidande boll (skid) får full tyngd. Bollen blir liggande på lutningar under mu / (5/7), ca 7,8 % på green vid stimp 10. Bryt, brytlinje och sikteslinje går alla genom samma fysik, så de ändras tillsammans.
- **Hålet:** radie 54 mm. En boll fångas om farten är högst `1,63 - 0,7 * (linjens avstånd från mitten / radien)` m/s. En boll som går över gränsen men högst 2,2 m/s och mer än 30 % av radien från mitten kantar hålet: den böjer av 10 + 35 * (avstånd/radie) grader bort från mitten, behåller 75 % av farten och läggs direkt över hålet så att den inte fångas igen. Snabbare bollar går över.
- Testerna: `tests/test_putt.js` (sträckor), `tests/test_putt_break.js` (bryt mot en oberoende integration av en rullande boll, kantning och fångst).

## Bollens spårlinje (tracer)

- `arcade.html` (flygloopen) skriver en punkt per fysiktick (5 ms) till `tracerPositions`/`tracerColors` (högst 6 000 punkter; simuleringen stannar efter 25 s, alltså 5 000). Färgbufferten är rgba (4 per punkt) så att en stil kan tona ut svansen med vertex-alfa.
- Bollen interpoleras mellan två tick, de skrivna punkterna är hela tick: därför ritas en extra punkt på bollens exakta plats i varje bild (aldrig sparad), annars släpar linjen upp till farten x 5 ms efter (37 cm vid 75 m/s).
- `arcade-tracer-engine.js`: fade efter landning följer klocktid (`TRACER_FADE_DURATION_MS` = 3 000 ms, oberoende av bildhastighet), och Phantom tonar ut mot svansen (`applyTracerTailFade`: alfa 1 vid bollen, 0,08 vid 3 s ålder).
- `tests/test_tracer.js` testar fade-tiden och svansen.

## Sikte i game mode (2026-10)
- Siktet är `window.aimTarget`; slaget går längs boll → aimTarget (`executeArcadeShot`, `atan2(dX, -dZ)`). Matten (bäring, vridning, när ett handsatt sikte behålls, tap vs drag) ligger i `arcade-aim.js` (`window.AimMath`, testad i `tests/test_aim.js`).
- Man siktar genom att **trycka på marken i 3D-vyn** (kort tryck utan drag; drag är kamera), på minimapen, med **piltangenter** (±1°, Shift ±5°) eller AIM-knapparna ◀ ▶ till vänster. **F** / ⚑ Flag sätter siktet på flaggan (på rangen rakt fram).
- Ett handsatt sikte (`window.aimManual`) ligger kvar efter slaget så länge det är minst 10 m bort och på flaggans sida om bollen (`resetAimTarget(true)`); ny spelare, nytt hål, mulligan och drop nollställer det alltid.
- Målmarkör (ring + stolpe) och streckad siktlinje ritas varje bildruta; minimapens "x° RIGHT/LEFT" och AIM-panelen visar vridningen bort från flaggan.
- **Putt-sikte på greenen:** i puttläge (`isPuttingMode`) kan siktmarkören **dras** direkt längs greenen (tryck på markören, dra; trycket startar bara på markören så drag annars är kamera, `window._aimDragging` stänger av orbit). Tap fungerar också (minsta avstånd 0,25 m mot 1,5 m i vanligt slag). Break-linjen (`puttPathForAim`, assist FULL) räknas om live mot siktet; SLOPE/OFF visar ingen linje. Siktet är bara **riktning** – puttens tempo är alltid mot hålet (`aimDistanceM` i puttläge), samma tempo som linjen ritas med, så man kan sikta på höga sidan av en breaking-putt.

## Slagplan i siktbrickan (2026-10)
- Brickan vid siktpunkten visar klubb och kraft som når siktet, carry/total, vindens och terrängens effekt (+ hjälper, − stjälper) och "plays X" (den platta, vindstilla distans slaget är värt). `updateShotPlan` i `arcade.html` kör samma fysik som slaget (`simulateFlight`, riktig terräng och vind, perfekt träff, utan träd) och söker kraften i `arcade-shot-plan.js` (`powerFor`, `pickClub`, `describe`). Ca 8–23 korta flygningar, 40–90 ms, körs först när siktet legat stilla 220 ms (vinddrift räknas om högst var 2:a sekund).
- Klubbval: den kortaste klubb som klarar slaget på högst 97 % kraft; den klubb som föreslogs sist behålls medan den behöver 60–97 %. Förslaget utgår från siktpunkten, inte flaggan. Putt/greenen och ≤ 9 m har egen hjälp och ingen plan.
- Spelarens eget klubbval (klubbknapparna) står kvar till nästa slag (`SwingEngine.newShot`); förut ångrades det direkt av förslaget (`selectClub` → `updateSwingInfoBar`). Förhandsvisningen är approximativ: vinden som blåser nu, inga träd, ingen slumpad flyer.

## Flygkamera (2026-10)
- Efter ett slag regisseras kameran av `arcade-flight-cam.js` (`FlightCam`) i stället för att jaga bollen: hela flygbanan är känd i förväg, så kameran får en plan. **Tee-kamera** (positionen står still, bara panorering/tiltning/zoom, en snabb inzoomning vid träffen, synfältet 60° → ca 18°) tills apex; **överlämning** längs en båge från apex till en **landningsvy** (bakom, ovanför och lite vid sidan av landningspunkten) som nås före landningen; efter landning följer kameran bollen med samma förskjutning. Allt går på tid (bildruteoberoende, kritiskt dämpade fjädrar), inte på per-bildruta-lerp.
- **Slow motion** (0,4×) runt landningen av fulla slag (`speedAt`, ca 0,5 s extra), via uppspelningshastigheten i flygloopen. Putt och rullande slag (`profile` = ground) behåller den gamla jaktkameran; chip/korta slag får en närmare landningsvy utan slow motion.
- En **glödande punkt** (`_ballBeacon`, fast storlek på skärmen) visar bollen från tee där den riktiga bollen är under en pixel; den tonas bort när bollen är stor nog.
- Efter flygningen: en resultatpaus (600 ms), siktblicken glider till siktpunkten (förut hopp) och linsen går tillbaka till 60°. Gäller bara AUTO-kameran; FREE-kameran är orörd.
- `tests/test_flight_cam.js` mäter bl.a. att bollen är i bild ≥ 98 % av bildrutorna, vinkelhastighet ≤ 3 rad/s, samma resultat vid 30/60/144 fps, kamerahöjd över marken.
- **Etapp 2:** fyra slagtyper (`profile`): ground (putt/rollare, gamla kameran), short (chip/pitch, närmare vy, lätt zoom, ingen slow motion), approach (35–140 m, slow motion 0,35×) och long (drivar, 0,45×, bredare båge, zoom ner mot 17°). Kameran håller sig över träd längs flygningen (`buildCameraObstacles` ger upprätta cylindrar `{x, z, r, top}`; bågen får en mjuk lyftning och kameran ligger minst 1,8 m över toppen). Vid approach hålls pinnen i bild efter landning (blicken delvis mot pinnen, något vidare lins). **Hoppa över:** tryck på bilden eller Space/Enter/Esc (`skipFlight`, inte de första 500 ms) lägger bollen i slutet av banan; en liten "TAP TO SKIP"-text visas under flygningen.

## Banor av flera plattor (collections) (2026-10)
- En samling har en `type` (3, 6, 9 eller 18) som är en kapacitet: antal hål, alltså antal plattor × 3, som den har plats för. Den kan sparas med färre plattor (ofärdig) och spelas då bara med de plattor den har; först när varje plats är fylld får den topplista och handicapdifferential (`GET /api/collections/:id/leaderboard` ger inga resultat för en ofärdig samling). Plattorna är publicerade 3-hålsplattor (en platta per sida i spelet). Reglerna för plattlistan (antal som ryms, ingen platta två gånger, varje platta finns och är publicerad) ligger i `collections-core.js` och kontrolleras av servern; serverns egen totalpar och slagindex räknas om när en platta publiceras igen.
- Spelet sparar per samling i `sessionStorage` (`collection_*_<NYCKEL>`, nyckeln är samlingens id i versaler): poäng, rundtoken, deltagare, plattor och plattversioner. `collection-round.js` (`CollectionRound.continueRound`) fryser plattornas ordning vid start och avgör om rundan ändrats: en platta har tagits bort eller bytts ut, eller en redan spelad platta (före den aktuella) har publicerats på nytt. Då spelas det som återstår som vanliga rundor ("COURSE CHANGED"). En platta som ännu inte spelats och publiceras på nytt ändrar inte rundan; dess sparade version uppdateras bara. Servern (`finalizeCollectionRound`) kräver att varje plattas `course_version` är aktuell och skriver ögonblicksbilden `collection_go` på resultatet.
- Laddningen försöker 3 gånger; misslyckas den visas "COULD NOT LOAD" med Try again (`#collection-load-error` på desktop, motsvarande på mobil). Mobil (`arcade_mobile.html`, `arcade_mobile_hub.html`) spelar samlingar med nytt försök vid misslyckad sparning och ett lie-chip (`#lie-chip`).
- Handikapp: bara plats 0 (kontoinnehavaren) får differential; gäster (`stats.player_slot` ≠ 0) räknas inte. Test: `tests/test_collections.js`, `tests/e2e/collections-e2e.js`.

## Underlag, avdrag och lägen (2026-10)
- Underlagets multiplikatorer (`lieMultipliers`, `lieRange`, `lieEffectText` i `physics.js`) gäller också riktiga tal från en launch monitor: LM ger boll- och klubbdata, systemet omvandlar utfallet efter underlaget. Utslag (`isTeeShot`) tvingas till FAIRWAY.
- `arcade-relief.js` (`ReliefRules.checkDrop`): avdrag i sidled inom 2,5 m, i "line"-läge högst 60 m bakåt längs linjen, tolerans 1,5 m, och i samma bunker kontrolleras vägen var 0,25 m. `takePenaltyDrop` i `arcade-rules.js` frågar i bunker: +1 slag och droppa kvar i bunkern, eller +2 slag och droppa utanför. Putt i bunker följer sandreglerna. Test: `tests/test_relief.js`, `tests/test_sand.js`.

## Identitet och skydd (2026-10)
- **Id är inte hemligt.** `x-user-id` är enhetens UUID (`golf_os_device_id`). Ingen publik lista får därför innehålla ett användar-id: `publicRef()` (HMAC-SHA256 av id:t, nyckel `PUBLIC_REF_KEY`) ger `owner_ref`/`player_ref`, och `hideOwner`/`hidePlayer` byter ut `owner_id`/`player_id` mot dem plus `is_mine`/`is_me`. Klienterna använder `is_mine`, `is_me` och `can_edit`; enda undantaget är att `arcade-load.js` sparar `owner_ref` och bara kontrollerar att den finns ("banan har en ägare") innan en icke-ägare skickas bort från byggaren. Ta alltså inte bort `owner_ref` ur svaren utan att ändra den kontrollen.
- **Enhetens token.** `device-token.js` skapar en slumpad token (`golf_os_device_token`, 64 hex) och en `fetch`-omslag lägger den som `x-user-token` på varje anrop med `x-user-id`. Servern sparar bara SHA-256-hashen (`users.token_hash`). Första token ett id visar upp blir enhetens (`checkDevice`); därefter ger saknad eller fel token 401 i `authMiddleware`, och i `optionalAuth` behandlas anroparen som ingen. Ett id utan konto får ett konto bundet till första token. **Övergång:** ett id utan token som ingen enhet gjort anspråk på släpps fortfarande igenom, så att gamla klienter inte låses ute; den regeln kan skärpas när aktiva enheter hunnit göra anspråk.
- **Gränser** (`rate-limit.js`): skrivande anrop under `/api` 120/min och adress (`RATE_LIMIT_WRITES`), skapa konto 30/min (`RATE_LIMIT_REGISTER`), admininloggning 10/min (`RATE_LIMIT_LOGIN`); över gränsen 429 med `Retry-After`. JSON-kroppar: 100 kB för konto och admin, 1 MB för resultat, gilla och samlingar, 50 MB för banor, modeller och bilder; för stor kropp ger 413. `trust proxy` är 1 (Railway). Test: `tests/test_rate_limit.js` och `collections-e2e.js`.
- **Adminlösenordet** kommer från `ADMIN_PASSWORD`; saknas den används ett standardvärde i koden. Sätt alltid variabeln i produktion.

## Tester och CI (2026-10)
`.github/workflows/ci.yml` kör på varje PR och push till main: `unit` (`node tests/run.js`, alla `tests/test_*.js`), `api` (`tests/e2e/collections-e2e.js` mot Postgres) och `browser` (smoke, shape och courses-e2e i Chromium). Smokeprovet jämför mot `tests/smoke/baseline.json` (nya sidfel, förlorade `window`-globaler); webbläsarens egna globaler tas från en sida på samma origin så baslinjen inte beror på Chromium-version. Se `tests/README.md`.
