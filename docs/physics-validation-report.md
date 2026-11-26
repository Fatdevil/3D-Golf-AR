# Bollfysiken mot referensbanken

Genererad av `node tools/physics-validation.js --write` ur `physics-validation/` (inga datum: rapporten ändras bara när fysiken eller banken ändras).
Varje rad körs genom `physics.js` i vindstilla på plan fairway i radens förhållanden. Fel = motorn minus referensen.

## Referensbanken

| Källa | Typ | Kontrollerad | Rader |
|---|---|---|---|
| TrackMan LPGA Tour averages (meters) | tour-snitt | ja | 11 |
| TrackMan PGA Tour averages 2024 | tour-snitt | ja | 12 |

**Inga slagpar ännu.** Tour-snitten räcker inte för att avgöra hur fel motorn är (snittslagets carry är inte snittets carry). Lägg CSV-exporter från launch monitorernas appar i `physics-validation/references/shots/` (se README där).

## Rad för rad

| Rad | Typ | Mängd | Klubba | mph / ° / rpm | Carry yd (ref) | Fel | Topp yd (ref) | Fel | Landning ° (ref) | Fel |
|---|---|---|---|---|---|---|---|---|---|---|
| lpga-driver | average | calibration | Dr | 143.0 / 12.6 / 2506 | 216.8 (223.1) | -6.3 | 25.6 (26.2) | -0.6 | 36.9 (36.0) | +0.9 |
| lpga-3w | average | calibration | 3W | 135.0 / 11.6 / 2595 | 197.4 (200.1) | -2.7 | 20.3 (25.2) | -4.9 | 32.6 (38.0) | -5.4 |
| lpga-5w | average | calibration | 5W | 130.0 / 12.3 / 4320 | 196.2 (189.2) | +7.0 | 26.7 (25.2) | +1.6 | 41.6 (43.0) | -1.4 |
| lpga-hy | average | calibration | Hy | 125.0 / 12.3 / 4504 | 185.6 (178.3) | +7.3 | 24.5 (25.2) | -0.6 | 40.5 (45.0) | -4.5 |
| lpga-4i | average | calibration | 4i | 118.0 / 13.9 / 4608 | 172.1 (175.0) | -2.9 | 23.9 (25.2) | -1.3 | 40.9 (43.0) | -2.1 |
| lpga-5i | average | calibration | 5i | 114.0 / 14.6 / 4966 | 163.5 (166.2) | -2.8 | 23.6 (25.2) | -1.6 | 41.6 (45.0) | -3.4 |
| lpga-6i | average | test | 6i | 111.0 / 16.7 / 5904 | 155.5 (155.3) | +0.2 | 26.2 (25.2) | +1.0 | 45.3 (46.0) | -0.7 |
| lpga-7i | average | calibration | 7i | 106.0 / 18.5 / 6630 | 143.9 (143.3) | +0.6 | 25.4 (26.2) | -0.8 | 46.0 (47.0) | -1.0 |
| lpga-8i | average | calibration | 8i | 102.0 / 20.8 / 7413 | 134.3 (133.4) | +0.9 | 25.6 (27.3) | -1.8 | 47.4 (47.0) | +0.4 |
| lpga-9i | average | calibration | 9i | 95.0 / 23.5 / 7605 | 120.8 (122.5) | -1.7 | 24.3 (27.3) | -3.1 | 47.9 (48.0) | -0.1 |
| lpga-pw | average | calibration | PW | 88.0 / 25.2 / 8465 | 106.3 (110.5) | -4.2 | 21.5 (27.3) | -5.8 | 47.4 (48.0) | -0.6 |
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
| irons | 13 | 2.6 | +0.2 | 5.1 | 1.0 | -1.0 |
| wedges | 2 | 6.8 | -6.8 | 9.4 | 0.3 | -0.3 |
| woods | 8 | 7.2 | +3.8 | 9.6 | 2.2 | -1.6 |

## Per bollfart (kontrollerade rader)

| Grupp | n | Carry: medianfel yd | bias | p90 | Landning: medianfel ° | bias |
|---|---|---|---|---|---|---|
| 100-140 mph | 14 | 2.8 | -1.1 | 7.3 | 1.1 | -1.1 |
| 140+ mph | 7 | 6.7 | +5.1 | 9.6 | 2.6 | -1.8 |
| 60-100 mph | 2 | 2.9 | -2.9 | 4.2 | 0.3 | -0.3 |

## Målen

Målen gäller kontrollerade slagpar i testmängden. Tour-snitt räknas inte. Det är ambitioner, inte garantier.

| Mål | n | Medianfel | Gräns | Status |
|---|---|---|---|---|
| Fullslag: carry, medianfel högst 1,5 m | 0 | – yd | 1.6 yd | inga slagpar ännu |
| Wedgar 20-100 m: carry, medianfel högst 1 m | 0 | – yd | 1.1 yd | inga slagpar ännu |
| Landningsvinkel: medianfel högst 1,5° | 0 | – ° | 1.5 ° | inga slagpar ännu |

## Mot baslinjen

Ingen rad är sämre än baslinjen (marginal 0.5 yd / 0.5°).
