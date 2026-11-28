# Golf Combine – validering mot verkliga slag

Syftet är att kunna svara med riktiga slag på frågan: **hur många meter fel räknar spelets bollflykt vid 30, 50, 100 och 150 m?**

Inget här ändrar bollfysiken (`physics.js`), poängmodellen eller Combine-reglerna (`combine-core.js`). Valideringen läser slagbanken och sparar referensvärden i en egen tabell. Den skriver aldrig till ett slag, en poäng eller ett test.

## Två sorters validering

| | Frågan | Vad som behövs |
|---|---|---|
| **Teknisk** | Kommer mätdata fram, räknas poängen enligt reglerna, försvinner något? | Inget nytt: slagbanken och diagnosen räcker. |
| **Fysikalisk** | Motsvarar bollflykten verkligheten tillräckligt väl, särskilt vid korta slag? | Oberoende referensvärden från en launch monitor. |

## Källor till referensvärden

Kartläggningen gäller november 2026.

| Källa | Utgångsvärden | Carry | Total | Sidled | Hur det kommer in |
|---|---|---|---|---|---|
| GSPro Open Connect (bryggan `gspro-bridge/`) | ja | valfritt fält `BallData.CarryDistance` i yards | nej | nej | med slaget, `origin = live` |
| Launch monitorns app (Garmin Golf, Rapsodo, Mevo, Uneekor, SkyTrak eller liknande) | ja | ja | ofta | ofta | CSV-import i Training Lab, `origin = import` |

- Open Connect är ett protokoll för utgångsvärden. Spelet räknar själv fram carry ur dem. `CarryDistance` är valfritt, och **det är inte kontrollerat vilka launch monitorer som fyller i det**. Bryggan sparar värdet när det finns, och ett saknat värde förblir `null`.
- Appexporternas kolumnnamn är inte kontrollerade mot riktiga filer än. Tolken känner igen flera former av namnen (se `physics-validation/README.md`). Okända kolumner rapporteras.

## Två kvaliteter, som aldrig blandas

- **`lm_calculated`**: launch monitorns egen programvara har räknat fram värdet ur det den mätte. Det är en jämförelse mellan två modeller och säger inte var bollen landade. De flesta kamerabaserade och inomhusradar-monitorer ger den här sorten.
- **`measured_landing`**: en landningspunkt som faktiskt mättes, till exempel av en radar som följde hela flykten utomhus eller en uppmätt nedslagsplats.

Vid import väljer spelaren vilken sort filen har. Från bryggan är det alltid `lm_calculated`, eftersom Open Connect inte säger hur värdet togs fram.

## Konventioner

- **Enheter:** allt sparas i meter, och dessutom som det kom (värde och enhet). En importerad fil måste ange avståndsenhet i rubriken (`(m)`, `(yds)` med flera), eller så anger spelaren den. Enheten gissas aldrig. Bollfart i m/s eller km/h räknas om till mph.
- **Sidled:** tvärs mållinjen där bollen landade, **höger positiv**. `3.2 R` och `L 4` läses rätt. Ett tal utan L/R följer konventionen spelaren väljer (plus höger eller plus vänster).
- **Carry:** radiell, alltså raka avståndet från tee till landningspunkten med sidled inräknad. Både spelets och launch monitorns carry är radiell, och de jämförs med varandra.
- **Längs mållinjen** (`along`): avståndet nedåt mållinjen till landningspunkten. Det är vad ett Combine-mål poängsätts på, och det jämförs inte med någon referens.
- **Total:** visas, men räknas aldrig in i carryfelet. Spelets total rullar på en plan fairway, launch monitorns på dess egen markmodell.
- **Skillnad:** spelet minus referensen. Plus betyder att spelet flyger bollen längre eller mer åt höger.
- **Förhållanden:** spelet räknar i standardförhållanden (vindstilla, 15 °C, havsnivå, plan mark). Många launch monitorer normaliserar också, men inte alla. Skriv i källans namn vad som gällde, till exempel `Garmin R10 inomhus`.

## Vad som jämförs

Bara slag där **alla fem utgångsvärden** (bollfart, utgångsvinkel, spinn, spinnaxel, startriktning) finns i bryggans egen mätlista, inget är uppskattat och slaget inte är en felmätning. Resten räknas upp för sig:
- **uppskattade:** ett värde fylldes i av spelet;
- **obevisade:** ingen mätlista, till exempel en äldre brygga;
- **felmätningar:** en smash factor som ingen klubba ger;
- **utan referens.**

## Matchning vid import

En rad i filen kopplas till ett slag i slagbanken bara när den passar **exakt ett** launch monitor-slag i vald tidsperiod och **inget annat slag i filen** passar samma slag. Gränserna:

| Värde | Gräns |
|---|---|
| bollfart | ±0,5 mph |
| utgångsvinkel | ±0,5° |
| spinn | ±50 rpm eller ±2 % |
| startriktning | ±1°, när båda har den |
| slagnummer | lika, när båda har det |

Andra rader sparas inte och redovisas med skäl:
- `no_candidate`: inget slag har dessa värden;
- `ambiguous`: flera slag har dem;
- `shared`: flera rader passar samma slag.

Samma fil igen sparar inget två gånger, eftersom en referens skrivs en gång per slag, ursprung och källa.

## Rapporten

`GET /api/diagnostics` gäller de senaste 90 dagarna, eller `?from=YYYY-MM-DD&to=YYYY-MM-DD`, eller `?test=<id>`. Exporten finns som JSON (hela rapporten) eller CSV (`&format=csv`, en rad per slag och referens). Båda kan laddas ner i Training Lab.

- **Per slag:** utgångsvärden och mätlista, det som inte var uppmätt, felmätning med smash factor, fysikversion (slagets och serverns), serverns landning (carry, along, sidled, total) och enhetens egna värden bredvid. Enhetens värden används aldrig. Sist kommer referenserna med skillnaderna.
- **Per Combine-test:** testet räknas om med serverns bollflykt och jämförs med det sparade (total, officiellt, fysikversion). Varje mål visar sina slag med roll (räknat, giltigt omslag, extra slag som inte räknas), omslagsmärkningar som inte gäller, saknade mål och de värden som gör testet till träning.
- **Över många test:** felen per kvalitet och band av referensens carry (0–40, 40–60, 60–80, 80–120, 120–180, 180–250 och 250+ m). För carry och sidled visas antal, medel, median, spridning och medel av absolutfelet. Upprepbarheten per nivå är spridningen av totalen och av varje måls fel över officiella test med dagens fysikversion.

Ett band med färre än 5 slag är för litet för slutsatser och markeras.

## Att samla in

1. Slå på rangen med launch monitorn och bryggan, gärna Golf Combine 9 på nivån som passar. Ett slag per mål ger slag vid 30–190 m (standard) eller 20–100 m (nybörjare).
2. Exportera samma pass ur launch monitorns app som CSV.
3. Öppna Training Lab. Under Validering av bollflykten: välj filen, skriv källan och vad värdena är, och sätt perioden så att passet ingår. Importera.
4. Läs felen per band i kortet, eller ladda ner CSV-filen och analysera vidare.

För att mäta upprepbarheten: tre Combine-test med samma spelare och utrustning, på samma nivå.

Slagpar som ska bli en del av repots referensbank för fysiken läggs fortfarande i `physics-validation/references/shots/`, enligt `physics-validation/README.md`. Importen här gäller spelarens egna slag på servern.
