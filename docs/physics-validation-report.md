# Bollfysiken mot referensbanken

Genererad av `node tools/physics-validation.js --write` ur `physics-validation/` (inga datum: rapporten ändras bara när fysiken eller banken ändras).
Varje rad körs genom `physics.js` i vindstilla på plan fairway i radens förhållanden. Fel = motorn minus referensen.

## Referensbanken

| Källa | Typ | Kontrollerad | Rader |
|---|---|---|---|
| LPGA Tour averages 2014 (unverified) | tour-snitt | **nej** | 1 |
| TrackMan PGA Tour averages 2024 | tour-snitt | ja | 12 |

**Inga slagpar ännu.** Tour-snitten räcker inte för att avgöra hur fel motorn är (snittslagets carry är inte snittets carry). Lägg CSV-exporter från launch monitorernas appar i `physics-validation/references/shots/` (se README där).

## Rad för rad

| Rad | Typ | Mängd | Klubba | mph / ° / rpm | Carry yd (ref) | Fel | Topp yd (ref) | Fel | Landning ° (ref) | Fel |
|---|---|---|---|---|---|---|---|---|---|---|
| lpga14-driver (okontrollerad) | average | test | Dr | 140.0 / 13.2 / 2611 | 212.5 (218.0) | -5.5 | 26.1 (25.0) | +1.1 | 37.8 (37.0) | +0.8 |
| pga24-driver | average | calibration | Dr | 171.0 / 10.4 / 2545 | 271.8 (282.0) | -10.2 | 34.5 (35.0) | -0.5 | 41.6 (39.0) | +2.6 |
| pga24-3w | average | calibration | 3W | 162.0 / 9.3 / 3663 | 257.6 (249.0) | +8.6 | 35.0 (32.0) | +3.0 | 44.0 (44.0) | -0.0 |
| pga24-5w | average | calibration | 5W | 156.0 / 9.7 / 4322 | 245.6 (236.0) | +9.6 | 36.6 (33.0) | +3.6 | 46.2 (48.0) | -1.8 |
| pga24-hy | average | calibration | Hy | 149.0 / 10.2 / 4587 | 231.6 (231.0) | +0.6 | 34.8 (31.0) | +3.8 | 46.0 (49.0) | -3.0 |
| pga24-3i | average | calibration | 3i | 145.0 / 10.3 / 4404 | 224.7 (218.0) | +6.7 | 31.5 (30.0) | +1.5 | 44.0 (48.0) | -4.0 |
| pga24-4i | average | calibration | 4i | 140.0 / 10.8 / 4782 | 214.1 (209.0) | +5.1 | 31.3 (31.0) | +0.3 | 44.8 (49.0) | -4.2 |
| pga24-5i | average | test | 5i | 135.0 / 11.9 / 5280 | 203.0 (199.0) | +4.0 | 32.1 (33.0) | -0.9 | 46.4 (50.0) | -3.6 |
| pga24-6i | average | calibration | 6i | 130.0 / 14.0 / 6204 | 189.8 (188.0) | +1.8 | 34.7 (32.0) | +2.7 | 49.5 (50.0) | -0.5 |
| pga24-7i | average | calibration | 7i | 123.0 / 16.1 / 7124 | 173.6 (176.0) | -2.4 | 33.7 (34.0) | -0.3 | 50.3 (51.0) | -0.7 |
| pga24-8i | average | calibration | 8i | 118.0 / 17.8 / 8078 | 161.4 (164.0) | -2.6 | 32.2 (33.0) | -0.8 | 50.5 (51.0) | -0.5 |
| pga24-9i | average | calibration | 9i | 112.0 / 20.0 / 8793 | 148.6 (152.0) | -3.4 | 30.7 (32.0) | -1.3 | 50.9 (52.0) | -1.1 |
| pga24-pw | average | calibration | PW | 104.0 / 23.7 / 9316 | 132.6 (142.0) | -9.4 | 30.0 (32.0) | -2.0 | 52.0 (52.0) | +0.0 |

## Per klubbgrupp (kontrollerade rader)

| Grupp | n | Carry: medianfel yd | bias | p90 | Landning: medianfel ° | bias |
|---|---|---|---|---|---|---|
| irons | 7 | 3.4 | +1.8 | 5.1 | 1.1 | -1.1 |
| wedges | 1 | 9.4 | -9.4 | 9.4 | 0.0 | +0.0 |
| woods | 4 | 9.1 | +4.6 | 10.2 | 2.2 | -0.9 |

## Per bollfart (kontrollerade rader)

| Grupp | n | Carry: medianfel yd | bias | p90 | Landning: medianfel ° | bias |
|---|---|---|---|---|---|---|
| 100-140 mph | 6 | 3.0 | -2.5 | 9.4 | 0.6 | -0.6 |
| 140+ mph | 6 | 7.7 | +5.9 | 10.2 | 2.8 | -2.4 |

## Målen

Målen gäller kontrollerade slagpar i testmängden. Tour-snitt räknas inte. Det är ambitioner, inte garantier.

| Mål | n | Medianfel | Gräns | Status |
|---|---|---|---|---|
| Fullslag: carry, medianfel högst 1,5 m | 0 | – yd | 1.6 yd | inga slagpar ännu |
| Wedgar 20-100 m: carry, medianfel högst 1 m | 0 | – yd | 1.1 yd | inga slagpar ännu |
| Landningsvinkel: medianfel högst 1,5° | 0 | – ° | 1.5 ° | inga slagpar ännu |

## Mot baslinjen

Ingen rad är sämre än baslinjen (marginal 0.5 yd / 0.5°).
