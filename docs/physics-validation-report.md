# Bollfysiken mot referensbanken

Genererad av `node tools/physics-validation.js --write` ur `physics-validation/` (inga datum: rapporten ändras bara när fysiken eller banken ändras).
Varje rad körs genom `physics.js` i vindstilla på plan fairway i radens förhållanden. Fel = motorn minus referensen.

## Referensbanken

| Källa | Typ | Kontrollerad | Rader |
|---|---|---|---|
| LPGA Tour averages 2014 (unverified) | tour-snitt | **nej** | 1 |
| TrackMan PGA Tour averages 2024 | tour-snitt | ja | 5 |

**Inga slagpar ännu.** Tour-snitten räcker inte för att avgöra hur fel motorn är (snittslagets carry är inte snittets carry). Lägg CSV-exporter från launch monitorernas appar i `physics-validation/references/shots/` (se README där).

## Rad för rad

| Rad | Typ | Mängd | Klubba | mph / ° / rpm | Carry yd (ref) | Fel | Topp yd (ref) | Fel | Landning ° (ref) | Fel |
|---|---|---|---|---|---|---|---|---|---|---|
| lpga14-driver (okontrollerad) | average | test | Dr | 140.0 / 13.2 / 2611 | 212.5 (218.0) | -5.5 | 26.1 (25.0) | +1.1 | 37.8 (37.0) | +0.8 |
| pga24-driver | average | calibration | Dr | 171.0 / 10.4 / 2545 | 271.8 (282.0) | -10.2 | 34.5 (35.0) | -0.5 | 41.6 (39.0) | +2.6 |
| pga24-5i | average | test | 5i | 135.0 / 11.9 / 5280 | 203.0 (199.0) | +4.0 | 32.1 (33.0) | -0.9 | 46.4 (50.0) | -3.6 |
| pga24-7i | average | calibration | 7i | 123.0 / 16.1 / 7124 | 173.6 (176.0) | -2.4 | 33.7 (34.0) | -0.3 | 50.3 (51.0) | -0.7 |
| pga24-9i | average | calibration | 9i | 112.0 / 20.0 / 8793 | 148.6 (152.0) | -3.4 | 30.7 (32.0) | -1.3 | 50.9 (52.0) | -1.1 |
| pga24-pw | average | calibration | PW | 104.0 / 23.7 / 9316 | 132.6 (142.0) | -9.4 | 30.0 (32.0) | -2.0 | 52.0 (52.0) | +0.0 |

## Per klubbgrupp (kontrollerade rader)

| Grupp | n | Carry: medianfel yd | bias | p90 | Landning: medianfel ° | bias |
|---|---|---|---|---|---|---|
| irons | 3 | 3.4 | -2.4 | 4.0 | 1.1 | -1.1 |
| wedges | 1 | 9.4 | -9.4 | 9.4 | 0.0 | +0.0 |
| woods | 1 | 10.2 | -10.2 | 10.2 | 2.6 | +2.6 |

## Per bollfart (kontrollerade rader)

| Grupp | n | Carry: medianfel yd | bias | p90 | Landning: medianfel ° | bias |
|---|---|---|---|---|---|---|
| 100-140 mph | 4 | 3.7 | -2.9 | 9.4 | 0.9 | -0.9 |
| 140+ mph | 1 | 10.2 | -10.2 | 10.2 | 2.6 | +2.6 |

## Målen

Målen gäller kontrollerade slagpar i testmängden. Tour-snitt räknas inte. Det är ambitioner, inte garantier.

| Mål | n | Medianfel | Gräns | Status |
|---|---|---|---|---|
| Fullslag: carry, medianfel högst 1,5 m | 0 | – yd | 1.6 yd | inga slagpar ännu |
| Wedgar 20-100 m: carry, medianfel högst 1 m | 0 | – yd | 1.1 yd | inga slagpar ännu |
| Landningsvinkel: medianfel högst 1,5° | 0 | – ° | 1.5 ° | inga slagpar ännu |

## Mot baslinjen

Ingen rad är sämre än baslinjen (marginal 0.5 yd / 0.5°).
