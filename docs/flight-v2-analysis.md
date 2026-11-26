# Flight V2: ny aerodynamik, första analysen (2026-11)

Målet är en bollflykt som stämmer för hela spannet, från barn och nybörjare till tourspelare och från korta chippar till drivers med mycket hög bollfart. En ändring av `physics.js` ska inte tas in bara för att den passar TrackMans tour-snitt bättre.

**Slutsats i dag: `physics.js` ändras inte.** De nya formerna passar tabellen bättre men blir sämre vid kanterna av den. Kanterna är där slag utanför tabellen ligger, alltså långa drivers, juniorer och chippar.

## Underlaget

TrackMans PGA-tabell med alla tolv klubbor, driver till PW (`physics-validation/references/trackman-pga-2024.json`). Bollfarten går från 104 till 171 mph. Det finns inga kontrollerade referenser under 104 mph eller över 171 mph, och inga enskilda slag (slagpar).

Siffrorna i tabellen är avrundade till hela yards och grader, och de är snitt. Snittslagets carry är inte snittets carry. Ett fel på ungefär 1–2 yd eller 1° går därför inte att skilja från tabellens egen osäkerhet.

## Metoden (`tools/physics-fit.js`)

- **Formerna:** verktyget byter ut luftkoefficienterna i en kopia av `physics.js` i minnet, så filen skrivs aldrig. Form A med dagens värden ger exakt samma flykt som spelet, vilket ett test kontrollerar.
- **Inpassningen:** Nelder-Mead minimerar kvadratsumman av felen på carry (yd), topphöjd (yd) och landning (° med dubbel vikt). Parametrarna har gränser.
- **Fysisk form:** en form vars luftmotstånd faller med mer spinn avvisas, oavsett hur bra den passar tabellen. För B och C måste lutningen cdSpin + 2·cdSpin2·S vara minst 0 upp till S = 0,6. Över S = 0,6 hålls spinntermen konstant. En långsam boll med mycket spinn kan ha S ≈ 3, och där gav en tidigare inpassning Cd ≈ −2,2.
- **Korsvalidering:** bankens fasta uppdelning lägger bara en av tolv rader i testmängden, vilket inte räcker. Därför körs 6 vikningar. Varje vikning passas in på 10 rader och mäts på 2 rader den aldrig sett, en lång och en kort klubba. Varje rad hålls alltså utanför en gång. **Varje vikning startar från formens egna, runda startvärden.** Den startar inte från inpassningen på alla rader, och för form A inte heller från dagens värden, som är inpassade på rader i tabellen. Annars skulle de utanförhållna raderna läcka in i vikningen.
- **Svep:** slag som inte finns i tabellen (chippar från 20 mph, juniorer, amatörer och 185 mph-drivers) flygs med dagens fysik och med den nya. Svepet kontrollerar också att carry alltid växer med bollfarten och att luftmotståndet är positivt överallt.

## Formerna

| Form | Luftmotstånd Cd | Lyft Cl | Spinnavtagande |
|---|---|---|---|
| A (i dag) | cd0 + Reynolds-term + k·S | a·S^b, högst clMax | konstant |
| B | cd0 + Reynolds-term + k₁·S + k₂·S² (S högst 0,6) | clMax·(1 − e^(−S/k)), planar ut mjukt | konstant |
| C | som B | som B | växer med farten |

Alla former behåller dagens beteende för långsamma bollar: Cd stiger mot 0,40 under 20 m/s, och omvänd Magnus gäller för långsamma bollar med lite spinn.

## Resultat

Fel = motorn minus TrackMan. Tabellen visar medianen av absoluta fel, med största felet inom parentes.

| | Carry, inpassade rader | Landning, inpassade | **Carry, utanförhållna rader** | **Landning, utanförhållna** |
|---|---|---|---|---|
| I dag (ingen inpassning) | 4,5 yd (10,2) | 1,5° (4,2) | 4,5 yd (10,2) | 1,5° (4,2) |
| A, ny inpassning | 2,4 yd (12,0) | 1,6° (4,2) | 2,9 yd (**26,0**) | 1,5° (3,8) |
| B | 3,3 yd (7,4) | 0,9° (3,6) | 2,9 yd (**19,1**) | 1,4° (3,3) |
| C | 2,2 yd (7,1) | 1,8° (3,9) | 3,2 yd (**16,1**) | 1,2° (3,1) |

Det här säger tabellen:

- **Inne i tabellen blir det bättre.** Medianfelet på carry för rader formen aldrig sett går från 4,5 till cirka 3 yd.
- **Vid kanten blir det sämre.** När drivern hålls utanför hamnar den 16–26 yd för kort, mot 10 yd i dag. Drivern är tabellens snabbaste boll (76 m/s) och har lägst spinnfaktor (S ≈ 0,075). Ingen annan rad säger något om luftmotståndet där. Formerna extrapolerar alltså dåligt, och samma risk gäller i andra änden: barn, nybörjare och chippar.
- **Formerna tänjs:**
  - B och C hamnar precis på regeln om att luftmotståndet inte får falla med spinn (lutningen ≈ 0 vid S = 0,6). Inpassningen vill alltså ha ett luftmotstånd som faller med spinnet, vilket inte är fysik.
  - A och C hamnar vid den nedre gränsen för spinnavtagandet (0,5 % per sekund, mot de cirka 4 % som brukar mätas).
  - Formerna pressas för att passa tabellen. De beskriver inte bollen.
- **Ett mönster som ingen form klarar:** 3-trä, 5-trä och hybrid går 3–6 yd för högt i alla former, medan drivern får rätt topphöjd. Med ett lyft som bara beror på spinnfaktorn går det inte att få både drivern (S ≈ 0,075) och träna (S ≈ 0,11–0,15) rätt. Antingen beror lyftet också på farten (Reynolds-talet), eller så kommer skillnaden från att tabellen är snitt.

Svepet för form C, carry i meter vid 15 °C och havsnivå:

| Slag | I dag | C | Skillnad |
|---|---|---|---|
| Chip 20 mph | 6,2 | 6,2 | +1 % |
| Pitch 45 mph | 32,0 | 33,0 | +3 % |
| Wedge 60 mph | 52,0 | 53,9 | +4 % |
| Juniordriver 90 mph | 95,5 | 92,7 | −3 % |
| Driver 110 mph | 133,0 | 129,7 | −2 % |
| Driver 185 mph | 267,4 | 273,6 | +2 % |
| PW 104 mph (tour) | 119,0 | 123,1 | +4 % |

Carry växer med bollfarten överallt, och luftmotståndet är positivt överallt (0,15–0,50). Men långsamma slag flyttas upp till 3–4 % åt båda hållen utan något facit. Det är för mycket att ta in på en gissning.

## Kriterier för att ändra `physics.js`

1. Korsvalideringen blir bättre än i dag på de utanförhållna raderna, både i median och i största fel. Ingen utanförhållen rad får bli mer än 2 yd eller 1° sämre än i dag.
2. Ingen parameter ligger vid sin gräns, och regeln om att luftmotståndet inte får falla med spinn är inte det som håller formen på plats.
3. Svepet ändrar inget slag mer än 2 % där det saknas referens, om inte en referens för just det området visar att ändringen är rätt.
4. Valideringsbankens spärr är grön efter `--update-baseline`, och rapporten visar förbättringen.
5. Codex har granskat matematiken och metoden.

## Vad som behövs härnäst

- **Slagpar** (CSV från en launch monitors app), helst med långsamma slag: juniorer, nybörjare, wedgar och chippar. Det är där banken är tom, och det är dit en ny modell annars extrapolerar.
- **En kontrollerad tabell för lägre farter**, till exempel TrackMans LPGA- eller amatörsnitt från en skärmdump. LPGA-raden i banken är skriven ur minnet och räknas inte.
- **En form där lyftet beror på både spinnfaktorn och farten** (Reynolds-talet). Det är det enda som kan förklara att drivern och träna skiljer sig åt i tabellen, men formen bör inte provas förrän det finns data som kan avgöra den.

## Köra verktyget

```
node tools/physics-fit.js show                       dagens fel per rad
node tools/physics-fit.js cv --form C                korsvalidering (cirka 10–25 minuter)
node tools/physics-fit.js sweep --form C --params '[0.2238,0.071,0.3243,-0.2688,0.3629,0.1674,0.0051,-0.0038]'
```
