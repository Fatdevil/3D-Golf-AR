# Flight V2: ny aerodynamik, första analysen (2026-11)

Målet är en bollflykt som stämmer för hela spannet, från barn och nybörjare till tourspelare och från korta chippar till drivers med mycket hög bollfart. En ändring av `physics.js` ska inte tas in bara för att den passar TrackMans tour-snitt bättre.

**Slutsats i dag: `physics.js` ändras inte.** De nya formerna passar tabellen bättre men blir sämre vid kanterna av den. Kanterna är där slag utanför tabellen ligger, alltså långa drivers, juniorer och chippar.

## Underlaget

TrackMans PGA-tabell med alla tolv klubbor, driver till PW (`physics-validation/references/trackman-pga-2024.json`). Bollfarten går från 104 till 171 mph. Det finns inga kontrollerade referenser under 104 mph eller över 171 mph, och inga enskilda slag (slagpar).

Siffrorna i tabellen är avrundade till hela yards och grader, och de är snitt. Snittslagets carry är inte snittets carry. Ett fel på ungefär 1–2 yd eller 1° går därför inte att skilja från tabellens egen osäkerhet.

## Metoden (`tools/physics-fit.js`)

- **Formerna:** verktyget byter ut luftkoefficienterna i en kopia av `physics.js` i minnet, så filen skrivs aldrig. Form A med dagens värden ger exakt samma flykt som spelet, vilket ett test kontrollerar.
- **Inpassningen:** Nelder-Mead minimerar kvadratsumman av felen på carry (yd), topphöjd (yd) och landning (° med dubbel vikt). Parametrarna har fysiskt rimliga gränser.
- **Korsvalidering:** den fasta uppdelningen i valideringsbanken lägger bara en av tolv rader i testmängden, vilket inte räcker. Därför körs 6 vikningar. Varje vikning passas in på 10 rader och mäts på 2 rader den aldrig sett, en lång och en kort klubba. Varje rad hålls alltså utanför en gång.
- **Svep:** slag som inte finns i tabellen (chippar från 20 mph, juniorer, amatörer och 185 mph-drivers) flygs med dagens fysik och med den nya. Svepet visar hur mycket en ändring flyttar slag där det inte finns något facit, och om carry alltid växer med bollfarten.

## Formerna

| Form | Luftmotstånd Cd | Lyft Cl | Spinnavtagande |
|---|---|---|---|
| A (i dag) | cd0 + Reynolds-term + k·S | a·S^b, högst clMax | konstant |
| B | cd0 + Reynolds-term + k₁·S + k₂·S² | clMax·(1 − e^(−S/k)), planar ut mjukt | konstant |
| C | som B | som B | växer med farten |

Alla former behåller dagens beteende för långsamma bollar: Cd stiger mot 0,40 under 20 m/s, och omvänd Magnus gäller för långsamma bollar med lite spinn.

## Resultat

Fel = motorn minus TrackMan. Tabellen visar medianen av absoluta fel, med största felet inom parentes.

| | Carry, inpassade rader | Landning, inpassade | **Carry, utanförhållna rader** | **Landning, utanförhållna** |
|---|---|---|---|---|
| I dag (ingen inpassning) | 4,5 yd (10,2) | 1,5° (4,2) | 4,5 yd (10,2) | 1,5° (4,2) |
| A, ny inpassning | 2,4 yd (12,1) | 1,6° (3,3) | 2,7 yd (**24,5**) | 1,6° (3,7) |
| B | 1,9 yd (6,2) | 1,7° (3,3) | 2,7 yd (**17,2**) | 1,1° (3,2) |
| C | 2,1 yd (6,5) | 1,4° (2,8) | 2,6 yd (**16,3**) | 1,5° (2,7) |

Det här säger tabellen:

- **Inne i tabellen blir det bättre.** Medianfelet på carry för rader formen aldrig sett går från 4,5 till cirka 2,6 yd.
- **Vid kanten blir det sämre.** När drivern hålls utanför hamnar den 16–25 yd för kort, mot 10 yd i dag. Drivern är tabellens snabbaste boll (76 m/s) och har lägst spinnfaktor (S ≈ 0,075). Ingen annan rad säger något om luftmotståndet där. Formerna extrapolerar alltså dåligt, och samma risk gäller i andra änden: barn, nybörjare och chippar.
- **Formerna tänjs.** B hamnar vid gränserna för tre parametrar (cdSpin, cdSpin2 och spinDecay = 8 % per sekund, mot de cirka 4 % som brukar mätas). C hamnar vid gränsen för cdSpin. Det tyder på att formen pressas för att passa, inte att den beskriver bollen.
- **Ett mönster som ingen form klarar:** 3-trä, 5-trä och hybrid går 3–5 yd för högt i alla former, medan drivern får rätt topphöjd. Med ett lyft som bara beror på spinnfaktorn går det inte att få både drivern (S ≈ 0,075) och träna (S ≈ 0,11–0,15) rätt. Antingen beror lyftet också på farten (Reynolds-talet), eller så kommer skillnaden från att tabellen är snitt.

Svepet för form C, carry i meter vid 15 °C och havsnivå:

| Slag | I dag | C | Skillnad |
|---|---|---|---|
| Chip 20 mph | 6,2 | 6,2 | +1 % |
| Pitch 45 mph | 32,0 | 32,9 | +3 % |
| Wedge 75 mph (barn eller nybörjare, fullt slag) | 75,7 | 78,7 | +4 % |
| Juniordriver 90 mph | 95,5 | 96,7 | +1 % |
| Driver 130 mph | 172,1 | 175,3 | +2 % |
| Driver 185 mph | 267,4 | 272,9 | +2 % |
| PW 104 mph (tour) | 119,0 | 126,6 | +6 % |

Carry växer med bollfarten överallt, och det gäller alla former. Wedgar och pitchar flyttas 3–4 % utan något facit. Det är för mycket att ta in på en gissning.

## Kriterier för att ändra `physics.js`

1. Korsvalideringen blir bättre än i dag på de utanförhållna raderna, både i median och i största fel. Ingen utanförhållen rad får bli mer än 2 yd eller 1° sämre än i dag.
2. Ingen parameter ligger vid sin gräns.
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
node tools/physics-fit.js sweep --form C --params '[0.1987,0.0286,0.4995,-0.4598,0.3646,0.1553,0.0076,0.0423]'
```
