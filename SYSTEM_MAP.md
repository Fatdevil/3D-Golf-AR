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

Grästextur på deep rough (av som standard, `?grasstex=1` eller `=2` (andra tilen, `grass-tile-2.jpg`, finare och mer upprättstående blad) slår på och minns, `?grasstex=0` stänger av; kreditering i `CREDITS.md`): `grass-tile.jpg` (1024², gråskala, sömlös tile gjord av en stockbild-grästextur uppifrån, ca 270 KB) laddas av `setGrassTex` och multipliceras som ljus/mörker på biomens färg i skalshadern, bara för deep rough, i två skalor (den andra roterad) så att tile-upprepningen inte syns. Mipmaps tonar ut den på avstånd. Ingen höjd eller siluett, bara yta. Kontrollera att bildens licens tillåter publicering.

Kantviktning (av som standard, `?grassedge=1` slår på och minns, `?grassedge=0` stänger av): `setEdgeMapFromMask` (hoppas över medan både kantfunktionerna är av, byggs vid påslag) bygger en 1024×1024 "närhet till kant"-karta (1 vid kant mot fairway/green/sand, 0 några meter in, `edgeWidth` 5,5 m). Långt inne i gräset ritas bara de nedre skalen (`_isInteriorLayer`: skal 1, plus ett mittskal på MED/HIGH), nära kant alla; en dither gör övergången mjuk. De övre skalen får dessutom bara geometri i kantremsan (`_buildStrip`: ett eget index över samma hörn, bara rutor med gräs vid en kant, plus en ruta marginal), så trianglarna minskar och inte bara pixlarna (i smoke-testets fairway-ruta 2 000 av 80 000 trianglar per övre skal). Bildtid på riktig mobil är ännu inte mätt.

## Kantstrån: riktiga strån längs gräsets kanter (2026-10, av som standard)
`terrain-shells.js`, `_buildBlades`: längs varje gräns mellan skalgräs och fairway/green/sand (klasskartan 1024×1024 som också ger kantkartan) står riktiga, avsmalnande strån, ett instansierat blad (7 hörn, 5 trianglar) med egen shader. HIGH/MED/LOW: 10/6/3 strån per gränscell (cellen är 0,59 m) och ritavstånd 120/70/40 m. Stråna grupperas i 48 m-bitar som kullas och göms på avstånd; slumpen är deterministisk per cell, så stråna ligger kvar när masken byggs om. Höjd = rough/deep/semi-höjden × 0,75-1,25; rötterna följer terrängen (`getTerrainHeight`, uppdateras 300 ms efter att marken ändrats i `syncHeights`). Bredden vid roten är 2,5 cm (överdriven med flit, ett verkligt strå är några mm). Av som standard: `?grassblades=1` slår på och minns, `?grassblades=0` stänger av. Provat i swiftshader: ungefär +50-150 ms bildtid med 2 800 strån, vilket inte säger något om en riktig GPU; på en riktig bana kan det bli tiotusentals strån, så mät på mobil innan det blir standard.

## Dialoger i #ui-layer tar emot klick själva
`#ui-layer` har `pointer-events: none`, och barn ärver det. En helskärmsdialog som ligger i den måste ha `pointer-events: auto` på sig själv, annars faller klicken igenom till canvasen och knapparna är döda. Det drabbade vattenhindrets dialog (`#penalty-decision-modal`, REHIT / LATERAL DROP) och publiceringsgalleriet (`#gallery-modal`). Röktestet kontrollerar att knapparna i båda nås av `elementFromPoint`.
