# Valideringsbanken för bollfysiken

Här mäts hur långt bollfysiken (`physics.js`) ligger från verkliga golfslag, per klubba och per bollfart. Det är grunden för allt fysikarbete: en ändring av fysiken ska göra banken bättre, inte bara en enskild klubba.

- `references/*.json`: tabeller med referensrader. Varje rad har indata (bollfart, utgångsvinkel, spinn) och mål (carry, topphöjd, landningsvinkel), plus källa, om den är kontrollerad och vilka förhållanden som gällde.
- `references/shots/*.csv`: **slagpar** från launch monitorernas egna appar, alltså utgångsvärdena och den carry launch monitorn mätte för samma slag. Det är den starkaste referensen.
- `validate.js`: läser banken, kör varje rad genom fysiken och räknar fel.
- `baseline.json`: vad fysiken ger i dag för tabellraderna. Testet `tests/test_physics_validation.js` misslyckas om en rad blir mer än 0,5 yd eller 0,5° sämre.
- Rapporten: `node tools/physics-validation.js --write` skriver `docs/physics-validation-report.md`.

## Lägga till slagpar (CSV)

1. Exportera slagen från launch monitorns app (Garmin Golf, Rapsodo, Mevo, Uneekor, SkyTrak eller liknande) som CSV.
2. Lägg filen i `references/shots/`, med ett namn som säger var den kommer ifrån, till exempel `garmin-r10-2026-11-anna.csv`.
3. Kör `node tools/physics-validation.js` och se att filen lästes. Rapporten visar hur många rader som lästes och vilka som hoppades över, med anledning.

Filen behöver kolumner för bollfart, utgångsvinkel, spinn och carry. Startriktning, spinnaxel, klubba, temperatur och höjd över havet läses om de finns. Kolumnnamnen känns igen i flera former (`Ball Speed`, `Launch Angle`, `Spin Rate`, `Spin Axis`, `Launch Direction`, `Carry Distance` med flera). Enheter läses ur rubriken, till exempel `(mph)`, `(m/s)`, `(yds)`, `(m)`, `(°F)`, eller ur en andra rad med enheter. Semikolon och decimalkomma fungerar.

**Rubrikerna i de olika apparnas exporter är inte kontrollerade mot riktiga filer än.** Känns en kolumn inte igen, lägg en sidofil med samma namn och `.json`:

```json
{
  "source": "Garmin R10, inomhus, Anna, 2026-11",
  "columns": { "ballSpeed": "Ball Speed", "launch": "Launch Angle", "spin": "Spin Rate", "carry": "Carry Distance" },
  "units": { "ballSpeed": "mph", "carry": "yd" },
  "conditions": { "temperatureC": 20, "altitudeFeet": 0 }
}
```

### Regler

- **Carry måste vara launch monitorns egen.** En export från spelets rangesession innehåller carry från spelets egen fysik (kolumnen `carry_from` = `physics`). En sådan fil avvisas, annars skulle fysiken jämföras med sig själv.
- **Slag utan spinn hoppas över.** Fysiken skulle då flyga dem på en gissning.
- **Förhållandena spelar roll.** Många launch monitorer räknar om carry till standardförhållanden, och vissa visar faktiska förhållanden. Skriv vad som gäller i sidofilens `conditions` och `source`. Utan uppgift används 15 °C och havsnivå.
- **Kalibrering och test:** varje rad hamnar alltid i samma mängd (cirka 70 % kalibrering, 30 % test), styrt av en hash av radens id. En framtida inpassning av fysiken får bara titta på kalibreringsraderna. Målen mäts på testraderna.

## Det banken saknar i dag

- **Slagpar.** Utan dem går det inte att säga hur fel motorn är, eftersom tour-snitt inte är enskilda slag.
- **Resten av PGA 2024-tabellen:** 3-trä, 5-trä, hybrid samt 3-, 4-, 6- och 8-järn. Indata (bollfart, utgångsvinkel, spinn) finns inte i repot. Lägg in dem från TrackMans tabell, inte ur minnet.
- **LPGA 2014-raden är skriven ur minnet.** Den rapporteras för sig och avgör ingenting förrän den är kontrollerad.
