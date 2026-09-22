# Fullständig felrapport: SCULPT / FORM

**Granskningsdatum:** 2026-09-22  
**Granskad version:** `02a310c`  
**Omfattning:** Alla verktyg i gruppen **Forma terräng** – `SCULPT`, `SMOOTH`, `FLATTEN`, `RAMP`, `RIDGE` och `NOISE`. `MTN`/Mountain är uttryckligen undantaget.  
**Primär implementation:** `arcade.html`, med brusfunktioner i `arcade-perlin.js` och terrängsynk i `terrain-chunks.js`.

## Sammanfattning

Granskningen hittade **14 avvikelser**: **4 höga**, **7 medelhöga** och **3 låga**. De största riskerna är att ett avbrutet penseldrag inte färdigställs eller sparas, att `FLATTEN` inte behåller höjden från första klicket, att flera verktyg ger olika resultat beroende på bildfrekvens/mushastighet och att `NOISE`-amplituden inte är en maximal höjd trots att den dokumenteras så.

| ID | Allvar | Verktyg | Kort beskrivning |
|---|---|---|---|
| SF-01 | Hög | Alla | Avbrutet drag hoppar över normals-, chunk-, objekt- och autosave-slutsteget |
| SF-02 | Hög | Flatten | Målhöjden vandrar med pekaren i stället för att låsas vid första klicket |
| SF-03 | Hög | Sculpt/Noise/Ridge/Smooth | Resultatet beror på FPS och hur länge samma punkt hålls nere |
| SF-04 | Hög | Noise | “Amplitude” är en repetitionshastighet, inte maximal höjd; höjden är obegränsad |
| SF-05 | Medel | Smooth | In-place-utjämning är ordningsberoende och får riktningsbias |
| SF-06 | Medel | Noise | Högerklick “Erode” inverterar mönstret men sänker inte entydigt terrängen |
| SF-07 | Medel | Flatten | Verklig radie är 150 % av visad pensel/cursor |
| SF-08 | Medel | Alla | Mittenknapp/övriga musknappar startar ett ändrande drag |
| SF-09 | Medel | Alla | Global `pointerup` avslutar drag från fel pekare; ingen pointer capture/ID-spårning |
| SF-10 | Medel | Ridge | Första stillastående klicken gör inget och åsens orientering styrs av senaste korta segmentet |
| SF-11 | Medel | Flatten/Ridge | Verktygen kringgår Terrain Floor trots globalt golvlås |
| SF-12 | Låg | Flatten | Målhöjds-HUD kan ligga kvar efter verktygsbyte |
| SF-13 | Låg | Alla | Tomma/icke-ändrande klick fyller undo-historiken och markerar banan ändrad |
| SF-14 | Låg | Smooth/Flatten | Styrkeinställningen döljs/ignoreras; intensiteten kan inte kontrolleras konsekvent |

## Metod och avgränsning

Granskningen följde hela kedjan för varje verktyg:

1. val av verktyg och synlighet för kontroller,
2. `pointerdown`, riktning och undo-snapshot,
3. raycast/cursor och kontinuerlig applicering i animationsloopen,
4. höjdalgoritmen i `applySculpting()`,
5. `pointerup`, avbrott, terrängsynk, objektsnappning och autosave,
6. brusgeneratorns kontrakt och mönster.

Rapporten är en statisk kodgranskning kompletterad med parser- och konsistenskontroller. Ingen Mountain-kod eller Mountain-UX har bedömts, även när den delar vissa hjälpfunktioner med gruppen.

---

## Detaljerade fynd

### SF-01 — Avbrutet drag färdigställs inte

**Allvar:** Hög  
**Berör:** Alla granskade verktyg

**Observation:** Normalt `pointerup` beräknar om vertexnormaler och bounding-volymer, synkar dirty chunks och terrängskal, snappar objekt mot marken, bygger om vattenmask/overlays och schemalägger sparning (`arcade.html:14887–14930`). Händelserna `pointerleave`, `pointercancel` och `blur` gör däremot bara `isSculpting = false`, aktiverar kamerakontrollerna och nollställer föregående punkt (`arcade.html:14934–14957`).

**Konsekvens:** Om pekaren lämnar canvasen, OS:et avbryter pekaren eller fönstret tappar fokus efter en terrängändring kan:

- ljussättningen fortsätta använda gamla normaler,
- chunkgeometri/terrängskal vara delvis osynkade,
- träd, flaggor och andra objekt sväva eller hamna under mark,
- analyslager visa gammal data,
- ändringen sakna den autosave som normalt sker vid `pointerup`.

**Reproduktion:** Starta valfritt formverktyg, håll vänster knapp, ändra terrängen och dra sedan pekaren ut ur renderingsytan innan knappen släpps. Jämför med ett normalt avslutat drag och ladda därefter om innan en annan sparande åtgärd.

**Rekommendation:** Extrahera slutlogiken till `finalizeSculptStroke({save: true})` och anropa den från `pointerup`, `pointercancel`, `pointerleave`, `blur`, verktygsbyte och lägesbyte. Funktionen bör vara idempotent och endast köras om draget faktiskt ändrat data.

### SF-02 — Flatten låser inte första klickets målhöjd

**Allvar:** Hög  
**Berör:** `FLATTEN`

**Observation:** Vid dragets första frame lagras `window.sculptAnchorY = p2.y` och HUD:en visar denna höjd (`arcade.html:16633–16645`). Själva utjämningen använder emellertid `p1.y` (`arcade.html:16943–16946`). Efter första framen är `p1` föregående raycastpunkt eftersom `previousFrameHitPoint` uppdateras varje frame.

**Konsekvens:** Målhöjden ändras när användaren drar över befintliga kullar och dalar. Verktyget skapar därför en följande, mjuk kopia av underlaget i stället för en platta på den höjd som HUD:en lovar. HUD-värdet och faktiskt mål divergerar.

**Reproduktion:** Börja Flatten på en låg punkt och dra över en hög punkt. Om målet vore låst skulle hela draget närma sig starthöjden; nu börjar senare delar närma sig höjden under föregående pekarposition.

**Rekommendation:** Använd den redan lagrade `window.sculptAnchorY` för hela draget. Nollställ ankaret vid avslut/avbrott.

### SF-03 — Formresultat är bildfrekvensberoende

**Allvar:** Hög  
**Berör:** `SCULPT`, `SMOOTH`, `NOISE`, `RIDGE`

**Observation:** `applySculpting()` anropas från animationsloopen och applicerar fasta inkrement per frame: Sculpt använder `sculptStrength`, Smooth upp till `0.95` av differensen, Noise `0.12` av ett amplitudsteg och Ridge `0.05` meter (`arcade.html:16861–16968`). Ingen av dem multipliceras med tidssteget och inget avståndsbaserat stampintervall används.

**Konsekvens:** Samma fysiska gest ger mer deformation på en skärm/dator med hög FPS eller när pekaren hålls still längre. Inspelade instruktioner, touch och mus blir svåra att reproducera och banor blir maskinberoende.

**Reproduktion:** Håll Sculpt stilla i en sekund vid 30 respektive 120 FPS, eller dra samma sträcka med olika hastighet. Höjdändringen blir ungefär proportionell mot antalet renderade frames.

**Rekommendation:** Separera simulering från rendering. Skala kontinuerlig påverkan med klampad `deltaTime`, alternativt applicera stämplar på ett fast tids-/avståndsintervall. Definiera styrka i meter per sekund och skriv deterministiska tester med olika frameindelning.

### SF-04 — Noise-amplituden är inte en maximal höjd

**Allvar:** Hög  
**Berör:** `NOISE`

**Observation:** `arcade-perlin.js` beskriver `noiseAmplitude` som “max height in meters”. I appliceringen beräknas däremot målet från den **aktuella** höjden plus `noise * amp * 0.5`, varefter 12 % av differensen läggs till varje frame (`arcade.html:16884–16891`). Eftersom aktuell höjd är basen varje gång ackumuleras samma offset utan gräns.

**Konsekvens:** En inställning på exempelvis 1,0 m kan bygga betydligt mer än 1,0 m om användaren håller kvar penseln. Slideretiketten är materiellt missvisande och resultatet påverkas samtidigt av FPS.

**Reproduktion:** Välj Perlin, amplitud 1,0 m och håll penseln still på samma plats. Höjden fortsätter ändras förbi den utlovade amplituden.

**Rekommendation:** Ta en bas-höjdsnapshot vid dragstart och interpolera mot `baseHeight + noise * amplitude`, eller byt UI/kontrakt till “styrka m/s”. För ett terrängverktyg är snapshotvarianten mest förutsägbar.

### SF-05 — Smooth läser och skriver samma array i samma pass

**Allvar:** Medel  
**Berör:** `SMOOTH`

**Observation:** Loopen går radvis genom vertexarrayen. Varje vertex skrivs omedelbart efter att dess fyra grannar lästs (`arcade.html:16864–16883`). Väst- och nordgrannar kan därmed redan vara utjämnade medan öst- och sydgrannar fortfarande har originalvärden.

**Konsekvens:** Resultatet får en systematisk bias i loopens riktning och är inte symmetriskt. Samma formation roterad 180° behöver inte ge motsvarande resultat.

**Rekommendation:** Läs samtliga grannhöjder från en separat snapshot och skriv till live-arrayen (Jacobi-pass), eller använd en temporär buffer endast för brushens bounding box.

### SF-06 — Högerklickad Noise “Erode” sänker inte entydigt

**Allvar:** Medel  
**Berör:** `NOISE`

**Observation:** Hjälptexten säger “Hold Right: Erode terrain” (`arcade.html:15548`). Högerklick byter bara tecken på brusvärdet via `Math.sign(strength)` (`arcade.html:16884–16891`). Perlin och flera andra mönster innehåller både positiva och negativa värden.

**Konsekvens:** Högerklick sänker positiva brusområden men **höjer** negativa områden. Resultatet är ett inverterat mönster, inte erosion eller generell sänkning.

**Rekommendation:** Antingen döp om åtgärden till “Invert pattern”, eller implementera erosion som en negativ, positivdefinit signal, exempelvis `-Math.abs(noise)`/ett lokalt erosionsfilter. Specificera särskilt hur positiv-only `MOUNDING` ska bete sig.

### SF-07 — Flatten påverkar 50 % utanför cursor

**Allvar:** Medel  
**Berör:** `FLATTEN`

**Observation:** Cursor byggs med `currentBrushSize`, men `applySculpting()` sätter radien till `currentBrushSize * 1.5` endast för Flatten (`arcade.html:16745`).

**Konsekvens:** Terräng som visuellt ligger utanför penseln ändras. Det är särskilt riskabelt nära greener, bunkrar och vattenkanter.

**Rekommendation:** Låt påverkan matcha cursor, eller skala även cursorn och etiketten samt förklara den verkliga diametern.

### SF-08 — Mittenknapp startar terrängändring

**Allvar:** Medel  
**Berör:** Alla granskade verktyg

**Observation:** Sculpt-grenen vid `pointerdown` filtrerar inte till knapp 0 eller 2 (`arcade.html:14844–14866`). Allt som når grenen sätter `isSculpting = true`; annan knapp än höger behandlas som positiv riktning. Undo-snapshot tas dessutom före grenen.

**Konsekvens:** Mittenklick eller extra musknappar kan höja/ändra terräng när användaren försöker navigera. Hjälptexten lovar vänster/höger, inte “valfri knapp”.

**Rekommendation:** Returnera tidigt för `e.button !== 0 && e.button !== 2`, och gör knappmappningen explicit innan undo skapas.

### SF-09 — Drag är inte bundet till den pekare som startade det

**Allvar:** Medel  
**Berör:** Alla granskade verktyg, särskilt touch/penna

**Observation:** Koden sparar inget aktivt `pointerId`, använder inte `setPointerCapture()` och lyssnar på global `window.pointerup` (`arcade.html:14887`).

**Konsekvens:** En andra fingerkontakt kan avsluta det första fingrets drag; en release utanför elementet kan ge en annan ordning mellan `pointerleave` och `pointerup`; stylus + touch kan korsa tillstånd. Detta förstärker SF-01.

**Rekommendation:** Spara `activeSculptPointerId`, fånga pekaren på canvasen, ignorera move/up från andra ID:n och släpp capture i gemensam finalize.

### SF-10 — Ridge behöver rörelse och byter orientering efter senaste segmentet

**Allvar:** Medel  
**Berör:** `RIDGE`

**Observation:** Åsens normal räknas från `p1 -> p2`, där `p1` är föregående framepunkt, inte dragets start. Vid första/stillastående frame är längden noll och verktyget gör ingen deformation (`arcade.html:16947–16969`). Under en böjd gest roterar därför profilen kontinuerligt med varje kort mussegment.

**Konsekvens:** Ett klick gör ingenting trots “Hold Mouse”-instruktionen. Långsamma eller ryckiga drag kan skapa tvära riktningsskiften, korsande höjning/sänkning och FPS/mus-samplingsberoende resultat.

**Rekommendation:** Bestäm produktbeteendet: (a) rak ås från dragstart till aktuell punkt med snapshot, eller (b) penseldragen kurva med tangent från ett stabilt, avståndsbaserat fönster. Visa en förhandslinje. För klick utan riktning bör en definierad kamera-/världsorientering användas eller ingen undo skapas.

### SF-11 — Flatten och Ridge kringgår globalt terränggolv

**Allvar:** Medel  
**Berör:** `FLATTEN`, `RIDGE`

**Observation:** Golvklampen undantar uttryckligen Water, Flatten och Ridge (`arcade.html:16898–16901`). Ramp respekterar däremot samma globala `terrainFloorEnabled`/`terrainFloorLevel` (`arcade.html:16721–16725`).

**Konsekvens:** Ridge kan stegvis gräva ena sidan obegränsat under golvet, och Flatten kan dra större områden under golvet om ankaret redan ligger där. Globala inställningen beter sig därmed olika mellan formverktyg utan UI-förklaring.

**Rekommendation:** Undanta endast Water om det krävs av sjölogiken. Klampa Flatten och Ridge efter respektive beräkning, eller exponera ett tydligt per-verktyg-val “Ignore terrain floor”.

### SF-12 — Flatten-HUD kan bli kvar

**Allvar:** Låg  
**Berör:** `FLATTEN` och verktygsbyte

**Observation:** HUD:en visas/döljs endast när ett nytt formdrag får sin första frame (`arcade.html:16633–16644`). `setTool()` återställer dragstatus men döljer inte `flatten-hud` (`arcade.html:15275–15289`).

**Konsekvens:** Efter ett Flatten-drag kan texten “Flatten Target” ligga kvar när användaren väljer Sculpt, Smooth eller ett annat verktyg, tills ett nytt drag faktiskt startas.

**Rekommendation:** Dölj HUD i gemensam finalize och omedelbart när `toolName !== 'FLATTEN'`.

### SF-13 — Icke-ändrande klick skapar undo-poster

**Allvar:** Låg  
**Berör:** Alla granskade verktyg

**Observation:** `saveUndoState()` körs före verktygsgrenen för nästan varje pointerdown som inte är Measure/Spline/Smart Builder/Colorize (`arcade.html:14591–14594`). Det sker även för mittenknapp, klick utan träff och Ridge-klick som saknar riktning. Funktionen markerar dessutom dokumentet “Ändrad”.

**Konsekvens:** Den begränsade historiken på 20 poster kan fyllas med identiska snapshots, Redo rensas och användaren får falsk osparad-status.

**Rekommendation:** Skapa snapshot först när ett giltigt drag startas och pusha det endast när första faktiska mutationen sker. Alternativt jämför state/hash innan posten accepteras.

### SF-14 — Smooth/Flatten saknar styrkekontroll

**Allvar:** Låg  
**Berör:** `SMOOTH`, `FLATTEN`

**Observation:** `sculpt-strength-container` visas endast för `SCULPT` (`arcade.html:15455`), och algoritmerna använder hårdkodade faktorer (`0.3 * sizeBoost` respektive `0.2`) i stället för `sculptStrength`.

**Konsekvens:** Användaren kan inte göra kontrollerade subtila pass med Smooth/Flatten. Dessutom ökar Smooth automatiskt aggressiviteten med penselstorlek, så storlek ändrar både område och styrka.

**Rekommendation:** Separera radie och styrka. Visa en relevant styrkeslider för Smooth och Flatten och definiera den tidsoberoende, exempelvis procent per sekund.

---

## Verktygsvis slutsats

### Sculpt

Grundformen och falloffen är begripliga, men verktyget är FPS-beroende (SF-03), accepterar fel musknappar (SF-08), saknar robust pekarlivscykel (SF-01/SF-09) och kan skapa tom undo (SF-13). Golvklampen fungerar här, men dess effekt bör testas tillsammans med en tidsnormaliserad styrka.

### Smooth

Utöver gemensamma livscykelfel är kärnalgoritmen ordningsberoende (SF-05). Penselstorleken höjer implicit styrkan, medan ingen separat styrka visas (SF-14). Detta gör Smooth svårt att förutsäga och svårt att enhetstesta.

### Flatten

Flatten har den tydligaste semantiska buggen: visad ankarehöjd används inte av deformationen (SF-02). Påverkansområdet matchar inte cursorn (SF-07), golvlåset ignoreras (SF-11) och HUD-livscykeln är ofullständig (SF-12).

### Ramp

Ramp är bättre deterministisk än övriga eftersom den återställer en snapshot varje frame och räknar om från start till aktuell slutpunkt. Den respekterar golvlås. Den delar dock fel i dragets avbrott, knappfiltrering, pointer-ID och undo. Ett avbrutet rampdrag är särskilt dyrt eftersom `markAllDirty()` körs under draget men full slut-synk kan utebli.

### Ridge

Ridge är inkrementellt, FPS-beroende och orienteras av senaste mikrosementet (SF-03/SF-10). Ena sidan kan pressas under golvet (SF-11). Riktningen kan bytas med högerklick/touchknappen, men UI och geometri behöver ett tydligare kontrakt för “ås” kontra “tier”.

### Noise

Noise har både kontrakts- och algoritmfel: amplitud är inte ett maximum (SF-04), resultatet är FPS-beroende (SF-03) och högerklick är inversion snarare än erosion (SF-06). Bruskartan initialiseras slumpmässigt per sidladdning i `arcade-perlin.js`, så framtida reproducerbarhet/samarbete bör också överväga en sparad seed, även om redan applicerade vertexhöjder sparas.

---

## Rekommenderad åtgärdsordning

1. **Centralisera stroke-livscykeln:** `beginSculptStroke`, `markStrokeChanged`, `finalizeSculptStroke`, aktivt pointer-ID och pointer capture. Detta löser SF-01, SF-08, SF-09, SF-12 och SF-13 i samma förändring.
2. **Rätta Flatten:** använd `sculptAnchorY`, matcha cursor/radie och följ golvlåset.
3. **Gör deformation tids-/avståndsnormaliserad:** börja med Sculpt, Noise och Ridge; lägg regressionstest där samma 1-sekundsdrag delas i 30/60/120 steg.
4. **Gör Noise snapshotbaserad:** låt amplitud vara verklig maxhöjd och bestäm om högerklick betyder sänkning eller mönsterinversion.
5. **Dubbelbuffra Smooth:** snapshot som läskälla, separat styrka och tester för rotationssymmetri.
6. **Definiera Ridge-geometrin:** rak start–slut eller stabil kurvtangent, därefter förhandsvisning och tester.
