"""
Analyze SLS KLASS 1 data from Sundsvall area (block 25E024)
Compare with Klass 3 data to see the actual difference
"""
import laspy
import numpy as np
from pyproj import Transformer

t_inv = Transformer.from_crs("EPSG:3006", "EPSG:4326", always_xy=True)

path = "data/sundsvall_sls/69_6/25E024_690_62_7525.laz"
print(f"Reading {path}...")
print(f"File size: 105 MB")
laz = laspy.read(path)

xs = np.array(laz.x)
ys = np.array(laz.y)
zs = np.array(laz.z)

cx, cy = (xs.min()+xs.max())/2, (ys.min()+ys.max())/2
lon, lat = t_inv.transform(cx, cy)

print(f"\n{'='*60}")
print(f"  SLS Gen3 KLASS 1 — Block 25E024 (Sundsvall)")
print(f"{'='*60}")
print(f"  Total points: {len(xs):,}")
print(f"  SWEREF E: {xs.min():.0f} — {xs.max():.0f}")
print(f"  SWEREF N: {ys.min():.0f} — {ys.max():.0f}")
print(f"  GPS center: {lat:.4f}°N, {lon:.4f}°E")
print(f"  Z range: {zs.min():.1f} — {zs.max():.1f} m")

width = xs.max() - xs.min()
depth = ys.max() - ys.min()
area = width * depth
density = len(xs) / area if area > 0 else 0
print(f"  Coverage: {width:.0f} x {depth:.0f} m")
print(f"\n  🎯 DENSITY: {density:.1f} points/m²")

if density > 15:
    print(f"  ✅✅ VERY HIGH DENSITY — True Gen3 SLS!")
elif density > 8:
    print(f"  ✅ HIGH DENSITY — Significant improvement!")
elif density > 4:
    print(f"  ⚠️ Medium density — somewhat better")
else:
    print(f"  ❌ Low density — same as NNH")

# Comparison
print(f"\n  📊 Comparison:")
print(f"    Norrmjöle NNH (old):     ~2.0 p/m²")
print(f"    Söderslätts SLS Klass 3: ~1.7 p/m²")
print(f"    Sundsvall SLS Klass 1:   {density:.1f} p/m²  ← THIS FILE")
print(f"    Ratio vs NNH:            {density/2.0:.1f}x")

# Classifications
cls = np.array(laz.classification)
unique, counts = np.unique(cls, return_counts=True)
cls_names = {0:'Never classified', 1:'Unclassified', 2:'Ground', 3:'Low vegetation',
             4:'Medium vegetation', 5:'High vegetation', 6:'Building', 7:'Low point',
             9:'Water', 10:'Rail', 11:'Road surface', 17:'Bridge', 18:'High noise'}
print(f"\n  Point classifications:")
has_vegetation = False
has_buildings = False
for c, n in sorted(zip(unique, counts), key=lambda x:-x[1]):
    name = cls_names.get(c, f'Class {c}')
    pct = n / len(xs) * 100
    marker = ""
    if c in (3,4,5):
        has_vegetation = True
        marker = " 🌿"
    if c == 6:
        has_buildings = True
        marker = " 🏠"
    print(f"    {c:3d} {name:25s}: {n:>12,} ({pct:5.1f}%){marker}")

if has_vegetation:
    print(f"\n  ✅ Has VEGETATION classification (Klass 1 confirmed!)")
if has_buildings:
    print(f"  ✅ Has BUILDING classification!")

# RGB check
has_rgb = hasattr(laz, 'red') and hasattr(laz, 'green') and hasattr(laz, 'blue')
print(f"\n  Has RGB color: {'✅ YES!' if has_rgb else '❌ No'}")
if has_rgb:
    r, g, b = np.array(laz.red), np.array(laz.green), np.array(laz.blue)
    print(f"    R: {r.min()} — {r.max()}")
    print(f"    G: {g.min()} — {g.max()}")
    print(f"    B: {b.min()} — {b.max()}")

# NIR check
has_nir = hasattr(laz, 'nir')
print(f"  Has NIR: {'✅ YES' if has_nir else '❌ No'}")

# Intensity
if hasattr(laz, 'intensity'):
    intensity = np.array(laz.intensity)
    print(f"  Intensity range: {intensity.min()} — {intensity.max()}")

# Number of returns
if hasattr(laz, 'number_of_returns'):
    nr = np.array(laz.number_of_returns)
    unique_nr, counts_nr = np.unique(nr, return_counts=True)
    print(f"\n  Number of returns distribution:")
    for r_val, c_val in zip(unique_nr, counts_nr):
        print(f"    {r_val} returns: {c_val:,} ({c_val/len(xs)*100:.1f}%)")

# Tile metadata
import json
with open("data/sundsvall_sls/69_6/25E024_690_62_7525_tile.json") as f:
    tile = json.load(f)
    props = tile['features'][0]['properties']
    print(f"\n  Klassificeringsnivå: {props.get('klassificeringsniva', '?')}")
    print(f"  Senast ändrad: {props.get('senastandrad', '?')}")

# Sundsvalls GK check
svall_e, svall_n = 619384, 6920875
dist = ((cx-svall_e)**2 + (cy-svall_n)**2)**0.5
print(f"\n  Distance to Sundsvalls GK: {dist:.0f}m ({dist/1000:.1f}km)")

print(f"\n  Google Maps: https://www.google.com/maps/@{lat},{lon},16z/data=!3m1!1e3")
