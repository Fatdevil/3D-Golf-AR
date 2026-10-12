# Bollflykt: dokumenterad kontroll mot TrackMans Tour-snitt

**Status: utkast för granskning, 2026-10-12.** Det här är en dokumenterad kontroll, inte ett tillräckligt kalibreringsmål för att ändra fysiken: underlaget saknar miljöförhållanden och flygtid (se avsnitt 2 och 8). Inga lyft- eller luftmotståndskoefficienter är ändrade och `physics.js` är orörd. Alla siffror kommer från `tools/flight-reference-report.js`, som bara anropar motorn.

## 1. Sammanfattning

1. **Carry, driver:** med den rapporterade utgångsvinkeln 10,4° ger motorn 288 yd mot källans 282 yd (+2,3 % vid 15 °C och havsnivå, +4,2 % vid 25 °C och +6,1 % vid 25 °C och 1 000 ft). Motorn ligger alltså över källan och avvikelsen växer med varmare och högre miljö.
2. **Carry, järn:** 7-järnet (123 mph, 16,1°, 7 124 rpm) ger 162 yd mot 176 yd, alltså -8,0 % (-4,8 % vid 25 °C och 1 000 ft), och PW (104 mph, 23,7°, 9 316 rpm) ger 117 yd mot 142 yd, alltså -17,7 % (-15,5 % vid 25 °C och 1 000 ft). Ingen utgångsvinkel räcker för järnen: högsta carry motorn når är 164 yd för 7-järnet och 125 yd för PW (tabell B, vinkeloberoende).
3. **Bollbanans form:** källan TrackMan säger att toppen för driver och PW skiljer sig med bara cirka 3 yd/m. Med de rapporterade vinklarna (10,4° och 23,7°) ger motorn 49 yd för driver och 18 yd för PW, alltså en skillnad på 31 yd (tabell G). Det är den tydligaste avvikelsen. TrackMans PDF anger också topp och landningsvinkel per klubba; jag har inte kunnat läsa dem och har därför inte jämfört dem (se avsnitt 8).
4. **Mönstret:** motorn ligger över källan för driver (+2 till +6 %) och under för järn (-5 till -8 % för 7-järn, -16 till -18 % för PW). Avvikelsen har alltså olika tecken beroende på klubba, vilket pekar på en formfråga i lyft- och motståndskurvorna och inte på en jämn skalning. Det är en observation ur en enda tabell med okända miljöförhållanden, inte en slutsats om vilka koefficienter som är fel.
5. **Landningsvinkel och tid i luften:** underlaget saknar flygtid, och för landningsvinkel har jag bara en tumregel från 2016 (PDF:ens värden är inte lästa). Jag drar ingen slutsats om dem.
6. **Underlagets gräns:** TrackMans Tour-snitt anger inga miljöförhållanden (temperatur, höjd, vind) och blandar tävling och range. Avvikelserna ovan kan därför inte räknas om till koefficienter. Rapporten visar var motorn och datan skiljer sig åt, och är ett underlag för att besluta vad som ska kontrolleras härnäst.
7. **Spelets egna indata** (`CLUB_PROFILES`) kompenserar delvis: 7-järnet matas med 128 mph och 18,5° i stället för Tour-snittets 123 mph och cirka 16°. En omkalibrering av fysiken måste därför räkna om klubbprofilerna, annars ändras alla slags distanser i spelet.

## 2. Källor och vad de ger

Hämtade 2026-10-12.

**Underlaget enligt TrackMan.** TrackMans officiella sida ([Introducing updated Tour Averages](https://www.trackman.com/blog/golf/introducing-updated-tour-averages)) beskriver snitten för 2023. För herrarna anger TrackMan data från över 40 evenemang och över 200 spelare, från **både PGA TOUR och DP World Tour, med flest från PGA TOUR**, och från **både tävling och range**. Det är alltså inte ett rent PGA Tour-urval och inte ett rent tävlingsurval. Sidan erbjuder också nedladdning av snitten i flera format (yards eller meter). Jag har inte sett något om temperatur, höjd över havet, vind eller om banans skick, och inte heller någon uppgift om flygtid i det jag har läst.

**Begränsning av min läsning.** `trackman.com` och flera andra sajter går inte att nå från den här miljön (DNS-fel). Beskrivningen av urvalet ovan kommer ur sökresultatets återgivning av TrackMans sida, och siffrorna i tabellen nedan ur en sekundärkälla (Golf Monthly), inte ur TrackMans egna nedladdningar. Sidans publiceringsdatum är oklart: bloggen är märkt 2023, men Golf Monthly återger ett TrackMan-inlägg från maj 2024. Siffrorna måste kontrolleras mot TrackMans nedladdningsbara tabell innan någon fysikändring görs.

| Uppgift | Värde | Källa | Datum / data |
|---|---|---|---|
| Klubbhuvudets fart, bollfart, spinn, carry: driver | 115 mph, 171 mph, 2 545 rpm, 282 yd | [Golf Monthly](https://www.golfmonthly.com/tour/how-far-pga-tour-players-hit-every-club-in-the-bag) (återger TrackMans uppdaterade Tour-snitt) | 2023 års data (TrackMans Tour-snitt, urval enligt ovan), TrackMan-inlägg maj 2024 enligt sökresultatet |
| samma: 7-järn | 92 mph, 123 mph, 7 124 rpm, 176 yd | samma | samma |
| samma: PW | 84 mph, 104 mph, 9 316 rpm, 142 yd | samma | samma |
| Utgångsvinkel: driver 10,4°, 7-järn 16,1°, PW 23,7° | så som en granskare återgav dem ur [TrackMans PDF med 2024 års PGA-snitt](https://blog.trackmangolf.jp/wp-content/uploads/2024/05/PGA-tour-averages-50-x-70_2024_JP-1.pdf) (samma rader som övriga kolumner). **Jag har inte kunnat öppna PDF:en** (DNS-fel härifrån). Drivervinkeln 10,4° och spinnet 2 545 rpm bekräftas av en sekundärkälla ([Top Shelf Golf](https://topshelfgolf.com/blogs/golf/golf-swing-speed-chart), som anger TrackMans uppdatering från maj 2024). 7-järnets och PW:s vinklar är oberoende bekräftade bara av att Golf Digest anger 7-järnets vinkel som strax över 16° (odaterat). | TrackMan, maj 2024 (enligt Top Shelf Golf) | PDF:ens egna kolumner för topp och landningsvinkel är inte lästa |
| Toppens skillnad driver mot PW | cirka 3 yd/m | [TrackMan, Apex Height](https://www.trackman.com/blog/apex-height) | "senaste Tour-snitten" (urvalet enligt TrackMans sida ovan) |
| Topp driver | cirka 35 yd | Golf Monthly (samma artikel, sökresultatet) | 2023 års data |
| Topp, alla klubbor | "cirka 30 yd" | [Golf.com](https://golf.com/gear/this-is-how-high-pro-golfers-hit-their-clubs/) | odaterad, troligen äldre |
| Landningsvinkel | driver cirka 40°, wedge cirka 50° | [Golf News Net](https://thegolfnewsnet.com/golfnewsnetteam/2016/10/24/what-do-trackman-numbers-mean-interpret-results-launch-monitor-100881/) | 2016, tumregel |
| Flygtid | **saknas i underlaget** | - | - |
| Topp och landningsvinkel per klubba | finns enligt granskaren i PDF:en, **inte lästa av mig** | - | - |
| Miljöförhållanden (temperatur, höjd, vind, bana) | **saknas i underlaget** | - | - |

**Källkonflikt:** en annan sida (NEO Golf, "2024 season") anger andra siffror (driver 275 yd, PW 136 yd). Jag har inte kunnat avgöra vilket dataset den bygger på; rapporten använder 2023 års TrackMan-snitt ovan.

**Rättelse mot min tidigare rapport i chatten:** de Tour-värden jag då angav (driver 275, 7-järn 172, PW 136 yd) kom ur minnet och motsvarar äldre data. Med 2023 års data är de 282, 176 och 142 yd. Avvikelserna "9 till 16 % för kort" är därför ersatta av siffrorna här.

## 3. Hur motorn räknar och vad den antar

- Boll: massa 45,93 g, radie 21,335 mm (`physics.js:11-12`). RK4-integrator, 5 ms steg (`physics.js:491`).
- Luft: `calculateAirDensity(altFeet, tempC)` (`physics.js:77`), standardatmosfär utan luftfuktighet. Förval i motorn: 0 ft och 15 °C (`physics.js:476-479`). Kommentaren kallar 15 °C "USGA/Trackman standard"; det har jag inte kunnat verifiera.
- Luftmotstånd: Cd 0,235 (över 55 m/s), 0,24 till 0,26 (under), plus ett spinntillägg som kommentaren hänvisar till Bearman & Harvey 1976 (`physics.js:107-132`). Jag har inte kontrollerat formeln mot den artikeln.
- Lyft: tabell över spinnparametern (`physics.js:134-154`) och omvänd Magnus under 20 m/s och 2 250 rpm.
- Spinnavklingning: 5 till 7 % per sekund beroende på fart (`physics.js:297-305`). Okontrollerad mot golfbollsdata.
- Känslighet för miljön: från 15 °C till 25 °C ökar 7-järnets carry med 1,7 % (162,0 till 164,7 yd), och 1 000 ft till ökar den med ytterligare 1,8 % (167,6 yd).

## 4. Resultat

## A. Tour rows run through the engine (ball speed, spin, carry: the Golf Monthly table of the 2023 TrackMan averages; launch angle: as reported from the TrackMan PDF, driver confirmed by a second source; no wind, flat, no lie)

| Club | Ball mph | Spin rpm | Launch used | Env | Engine carry yd | Tour carry yd | Diff |
|---|---|---|---|---|---|---|---|
| Driver | 171 | 2545 | 10.4 (reported) | 15 C, 0 ft (engine default) | 288.3 | 282 | 2.3 % |
| Driver | 171 | 2545 | 10.4 (reported) | 25 C, 0 ft | 293.7 | 282 | 4.2 % |
| Driver | 171 | 2545 | 10.4 (reported) | 25 C, 1000 ft | 299.3 | 282 | 6.1 % |
| 7-iron | 123 | 7124 | 16.1 (reported) | 15 C, 0 ft (engine default) | 161.9 | 176 | -8.0 % |
| 7-iron | 123 | 7124 | 16.1 (reported) | 25 C, 0 ft | 164.6 | 176 | -6.5 % |
| 7-iron | 123 | 7124 | 16.1 (reported) | 25 C, 1000 ft | 167.5 | 176 | -4.8 % |
| PW | 104 | 9316 | 23.7 (reported) | 15 C, 0 ft (engine default) | 116.9 | 142 | -17.7 % |
| PW | 104 | 9316 | 23.7 (reported) | 25 C, 0 ft | 118.4 | 142 | -16.6 % |
| PW | 104 | 9316 | 23.7 (reported) | 25 C, 1000 ft | 119.9 | 142 | -15.5 % |

## B. Highest carry the engine can reach with the sourced ball speed and spin, over every launch angle 3-40 deg (15 C, 0 ft); independent of the launch angles in table A

| Club | Ball mph | Spin rpm | Max engine carry yd | At launch deg | Tour carry yd | Diff at best launch |
|---|---|---|---|---|---|---|
| Driver (max over launch angle) | 171 | 2545 | 288.4 | 11 | 282 | 2.3 % |
| 7-iron (max over launch angle) | 123 | 7124 | 164.4 | 22.5 | 176 | -6.6 % |
| PW (max over launch angle) | 104 | 9316 | 124.9 | 35 | 142 | -12.1 % |

## C. Launch-angle sensitivity (15 C, 0 ft)

| Club | Launch | Carry yd | Apex yd | Landing deg | Flight s |
|---|---|---|---|---|---|
| Driver | 3 | 277.4 | 26.3 | 35 | 6.9 |
| Driver | 5 | 282.5 | 32.6 | 39 | 7.3 |
| Driver | 7 | 285.8 | 38.9 | 42 | 7.7 |
| Driver | 9 | 287.7 | 45.1 | 44 | 8.0 |
| Driver | 10 | 288.2 | 48.2 | 46 | 8.2 |
| Driver | 11 | 288.4 | 51.3 | 47 | 8.3 |
| Driver | 12 | 288.4 | 54.3 | 48 | 8.5 |
| Driver | 13 | 288.1 | 57.4 | 48 | 8.6 |
| Driver | 15 | 286.7 | 63.4 | 50 | 8.9 |
| 7-iron | 15 | 160.7 | 23.7 | 41 | 4.8 |
| 7-iron | 16 | 161.8 | 25.3 | 42 | 4.9 |
| 7-iron | 17 | 162.7 | 26.9 | 44 | 5.0 |
| 7-iron | 18 | 163.4 | 28.5 | 45 | 5.1 |
| PW | 22 | 114.1 | 16.2 | 36 | 3.6 |
| PW | 24 | 117.3 | 18.5 | 39 | 3.8 |
| PW | 26 | 119.9 | 20.8 | 42 | 4.0 |
| PW | 28 | 121.9 | 23.1 | 45 | 4.3 |

## G. Apex height: Trackman says driver and PW apex differ by only about 3 yd/m (Trackman apex-height article, 2023 averages). The engine, 15 C, plausible launch angles:

| Case | Driver apex yd | PW apex yd | Difference yd | Sourced difference |
|---|---|---|---|---|
| launch 10.4 / 23.7 deg | 49.4 | 18.1 | 31.3 | about 3 |
| launch 10 / 24 deg | 48.2 | 18.5 | 29.7 | about 3 |
| launch 11 / 26 deg | 51.3 | 20.8 | 30.5 | about 3 |

Driverns carry varierar från 277 yd vid 3° till 288 yd vid 11° (tabell C) och toppen från 26 yd till 51 yd, så resultaten för driver är känsliga för utgångsvinkeln. Rapporten använder därför den rapporterade vinkeln 10,4° som huvudfall och visar svepet i tabell C.

## 5. Spelets egna indata

## D. What the game feeds the engine (CLUB_PROFILES at full power, arm 0, 15 C) against the yard labels in the UI and the Tour carry

| Club | Ball mph | Launch | Spin | Engine carry yd | UI label yd | Tour carry yd |
|---|---|---|---|---|---|---|
| DRIVER | 167 | 10.5 | 2500 | 281.8 | 220 | 282 |
| W3 | 155 | 12 | 3500 | 256.1 | 200 | - |
| I5 | 140 | 16 | 5300 | 210.5 | 180 | - |
| I7 | 128 | 18.5 | 7100 | 173.7 | 160 | 176 |
| I9 | 115 | 22 | 8700 | 138.3 | 140 | - |
| PW | 103 | 26 | 9300 | 118.2 | 120 | 142 |
| SW | 85 | 32 | 10200 | 92.4 | 90 | - |
| LW | 72 | 36 | 10800 | 73.4 | 60 | - |

Engine-carryn i kolumnen "Engine carry" är för 15 °C och full kraft. "UI label" är de yard-etiketter som visas i klubblistan (`arcade.html:3225-3249`) och som styr `autoSelectClub` (`arcade-swing-engine.js:68-80`, trösklar i meter: 201, 174, 151, 133, 114, 91, 55). De stämmer inte med vad motorn gör vid full kraft för de långa klubborna (driver: 220 mot 282 yd).

`CLUB_PROFILES` är märkt "Trackman PGA Tour averages (verified)" (`arcade-swing-engine.js:18`). Jämfört med 2023 års snitt är 7-järnets bollfart 128 mot 123 mph och utgångsvinkeln 18,5° mot cirka 16°. Jag har inte kunnat verifiera "verified" mot någon källa.

## 6. Var carry-målen i kommentarerna används

| Plats | Vad | Används av kod? |
|---|---|---|
| `physics.js:110-113` | "Kalibrerad mot Trackman", Cd 0,235 ger driver 215 yd, Cd 0,24 ger järn 185 yd | Bara kommentar. Siffrorna i koden som berörs är `getDragCoefficient` (`:107-132`), anropad i `evaluateState` (`:257`). |
| `physics.js:144` | "Kalibrerad: driver 216y, 7-iron 180y, wedge 130y, lob 75y" | Bara kommentar. Tabellen finns i `getLiftCoefficient` (`:134-154`), anropad i `evaluateState` (`:258`). |
| `tests/test_physics.js:96-122` | mål: driver 210-220, 7-järn 178-192 (kommentaren säger 180-188), wedge 125-135 yd | Ja, som tester. Indata är 130 mph/14°/2 000 rpm, 120 mph/16°/7 000 rpm och 103 mph/35°/9 000 rpm, alltså inte Tour-snitt. |
| `tests/run.js:10-13` | 7-järnets mål listas som känt fel ("physics was re-tuned after this test was written") | Ja, tolereras av testkörningen. |
| `arcade-swing-engine.js:22-32` | `CLUB_PROFILES` (indata per klubba) | Ja, `mapCircleToPhysics` (`:103-`) matar motorn med dem. |
| `arcade.html:3225-3249` | yard-etiketter i klubblistan | Bara visning. |

## E. The inputs of the targets in tests/test_physics.js (not Tour averages)

| Test | Ball mph | Launch | Spin | Engine carry yd | Test target |
|---|---|---|---|---|---|
| Driver | 130 | 14 | 2000 | 212.0 (25 C) | 210-220 |
| 7-iron | 120 | 16 | 7000 | 159.2 (25 C) | 178-192 (failing) |
| Wedge | 103 | 35 | 9000 | 125.9 (25 C) | 125-135 |

Driver och wedge klarar sina tester. 7-järnets test faller (159 mot 178 till 192 yd) och är det test som markerats som känt fel.

## 7. Integratorn

Skriptet räknar om tre slag med 5, 2,5 och 1,25 ms steg (varje körning är `physics.js` med ett annat steg, utvärderat ur källkoden i minnet; filen ändras inte). Skriptet stannar med ett fel om raden `const dt = 0.005;` inte finns exakt en gång, så ett ändrat steg missas inte tyst.

### Integrator step: the same shots with the step halved twice (15 C, 0 ft, no wind), each run on physics.js with another step

| Shot | Step ms | Carry yd | Apex yd | Flight s |
|---|---|---|---|---|
| Driver 171 mph, 11 deg, 2545 rpm | 5 | 288.43 | 51.27 | 8.34 |
| Driver 171 mph, 11 deg, 2545 rpm | 2.5 | 288.43 | 51.26 | 8.34 |
| Driver 171 mph, 11 deg, 2545 rpm | 1.25 | 288.43 | 51.26 | 8.34 |
| 7-iron 123 mph, 16.2 deg, 7124 rpm | 5 | 161.99 | 25.65 | 4.94 |
| 7-iron 123 mph, 16.2 deg, 7124 rpm | 2.5 | 162.00 | 25.65 | 4.94 |
| 7-iron 123 mph, 16.2 deg, 7124 rpm | 1.25 | 162.00 | 25.66 | 4.94 |
| PW 104 mph, 25 deg, 9316 rpm | 5 | 118.66 | 19.62 | 3.94 |
| PW 104 mph, 25 deg, 9316 rpm | 2.5 | 118.67 | 19.62 | 3.94 |
| PW 104 mph, 25 deg, 9316 rpm | 1.25 | 118.67 | 19.62 | 3.94 |

Largest difference from the 5 ms step: carry 0.010 yd, apex 0.006 yd. The 5 ms step is the one physics.js uses (driver carry 288.43 yd).

Skillnaden är högst 0,01 yd i carry och 0,01 yd i topp, så integratorn är inte felkällan. Det visar bara att integrationen är stabil, inte att krafterna och koefficienterna är rätt.

## 8. Vad rapporten inte visar

- Att krafterna, enheterna och koefficienterna i modellen är rätt. Integrationens stabilitet bevisar inte det.
- Någon jämförelse av tid i luften och landningsvinkel mot kontrollerade data.
- De rapporterade utgångsvinklarna (driver 10,4°, 7-järn 16,1°, PW 23,7°): de är återgivna av en granskare ur TrackMans PDF som jag inte har kunnat öppna. Drivervinkeln bekräftas av en sekundärkälla, de övriga inte. Topp och landningsvinkel per klubba står enligt granskaren i samma PDF och är inte jämförda här.
- Vilka miljöförhållanden Tour-snitten gäller: de anges inte, och datan blandar tävling och range. Känsligheten ovan visar att temperatur och höjd ger några procent, inte 8 till 12.
- Att siffrorna är riktiga: de kommer från en sekundärkälla och ska kontrolleras mot TrackMans nedladdning.
- Flygtid. Underlaget saknar den, så motorns tid i luften går inte att jämföra med något.

## 9. Hur rapporten bör användas

Rapporten är en dokumenterad kontroll: den visar var motorn och TrackMans Tour-snitt skiljer sig åt, med angivna indata, miljö och källor. Den är **inte** ett tillräckligt kalibreringsmål för att ändra lyft eller luftmotstånd, eftersom underlaget saknar miljöförhållanden och flygtid, blandar tävling och range, och eftersom siffrorna är hämtade ur en sekundärkälla.

Vad som krävs innan en fysikändring kan motiveras:

1. Öppna TrackMans egen PDF eller nedladdningsbara tabell, verifiera alla siffror ovan mot den och lägg till topp och landningsvinkel per klubba i jämförelsen (alla klubbor: bollfart, utgångsvinkel, spinn, topp, landningsvinkel, carry).
2. Skaffa data med kända miljöförhållanden och flygtid, eller en dokumenterad modell för hur Tour-snitten ska normaliseras.
3. Bestäm om `CLUB_PROFILES`, yard-etiketterna i klubblistan och `autoSelectClub` ska räknas om samtidigt som fysiken, och ersätt testmålen i `test_physics.js` med en daterad tabell.
4. Först då: en separat, testad fysikändring med före/efter mot samma tabell.
