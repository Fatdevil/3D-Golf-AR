"""
Analyze the new SLS Gen3 golf course data from block 25A001
"""
import laspy
import numpy as np
from pyproj import Transformer

t_inv = Transformer.from_crs("EPSG:3006", "EPSG:4326", always_xy=True)

path = "data/golfbana_sls/61_3/25A001_614_37_7575.laz"
print(f"Reading {path}...")
laz = laspy.read(path)

xs = np.array(laz.x)
ys = np.array(laz.y)
zs = np.array(laz.z)

# GPS coordinates
cx, cy = (xs.min()+xs.max())/2, (ys.min()+ys.max())/2
lon, lat = t_inv.transform(cx, cy)
lon_sw, lat_sw = t_inv.transform(xs.min(), ys.min())
lon_ne, lat_ne = t_inv.transform(xs.max(), ys.max())

print(f"\n{'='*60}")
print(f"  SLS Gen3 Block 25A001 — Golfbana")
print(f"{'='*60}")
print(f"  Total points: {len(xs):,}")
print(f"  SWEREF E: {xs.min():.0f} — {xs.max():.0f}")
print(f"  SWEREF N: {ys.min():.0f} — {ys.max():.0f}")
print(f"  GPS center: {lat:.4f}°N, {lon:.4f}°E")
print(f"  GPS SW: {lat_sw:.4f}°N, {lon_sw:.4f}°E")
print(f"  GPS NE: {lat_ne:.4f}°N, {lon_ne:.4f}°E")
print(f"  Z range: {zs.min():.1f} — {zs.max():.1f} m")

width = xs.max() - xs.min()
depth = ys.max() - ys.min()
area = width * depth
density = len(xs) / area if area > 0 else 0
print(f"  Coverage: {width:.0f} x {depth:.0f} m = {area/1e6:.2f} km²")
print(f"\n  🎯 DENSITY: {density:.1f} points/m²")

if density > 10:
    print(f"  ✅ HIGH DENSITY — This is real Gen3 SLS data!")
elif density > 5:
    print(f"  ⚠️ Medium density")
else:
    print(f"  ❌ Low density — same as old NNH data")

# Classifications
cls = np.array(laz.classification)
unique, counts = np.unique(cls, return_counts=True)
cls_names = {0:'Never classified', 1:'Unclassified', 2:'Ground', 3:'Low vegetation',
             4:'Medium vegetation', 5:'High vegetation', 6:'Building', 7:'Low point',
             9:'Water', 10:'Rail', 11:'Road surface', 17:'Bridge', 18:'High noise'}
print(f"\n  Point classifications:")
for c, n in sorted(zip(unique, counts), key=lambda x:-x[1]):
    name = cls_names.get(c, f'Class {c}')
    pct = n / len(xs) * 100
    print(f"    {c:3d} {name:25s}: {n:>12,} ({pct:5.1f}%)")

# RGB check
has_rgb = hasattr(laz, 'red') and hasattr(laz, 'green') and hasattr(laz, 'blue')
print(f"\n  Has RGB color: {'✅ YES!' if has_rgb else '❌ No'}")
if has_rgb:
    r = np.array(laz.red)
    g = np.array(laz.green) 
    b = np.array(laz.blue)
    print(f"    R: {r.min()} — {r.max()}")
    print(f"    G: {g.min()} — {g.max()}")
    print(f"    B: {b.min()} — {b.max()}")
    # Check if RGB is actually populated (not all zeros)
    if r.max() > 0 or g.max() > 0:
        print(f"    ✅ RGB data IS populated!")
    else:
        print(f"    ❌ RGB fields exist but are empty (all zeros)")

# NIR (Near Infrared) check - useful for vegetation
has_nir = hasattr(laz, 'nir') or hasattr(laz, 'near_infrared')
print(f"  Has NIR: {'✅ YES' if has_nir else '❌ No'}")

# Intensity check
has_intensity = hasattr(laz, 'intensity')
if has_intensity:
    intensity = np.array(laz.intensity)
    print(f"  Intensity range: {intensity.min()} — {intensity.max()}")

# Check tile metadata
print(f"\n  Tile metadata file...")
import json
with open("data/golfbana_sls/61_3/25A001_614_37_7575_tile.json") as f:
    tile = json.load(f)
    feat = tile['features'][0]
    props = feat['properties']
    print(f"    Klassificeringsnivå: {props.get('klassificeringsniva', 'unknown')}")
    print(f"    Senast ändrad: {props.get('senastandrad', 'unknown')}")

# Ground points analysis (for terrain quality) 
ground_mask = cls == 2
ground_count = ground_mask.sum()
ground_density = ground_count / area if area > 0 else 0
print(f"\n  Ground points: {ground_count:,} ({ground_density:.1f} p/m²)")

# Vegetation analysis
veg_mask = (cls >= 3) & (cls <= 5)
veg_count = veg_mask.sum()
print(f"  Vegetation points: {veg_count:,}")
if veg_count > 0:
    veg_z = zs[veg_mask]
    print(f"    Vegetation height range: {veg_z.min():.1f} — {veg_z.max():.1f} m")

print(f"\n{'='*60}")
print(f"  Google Maps link: https://www.google.com/maps/@{lat},{lon},16z")
print(f"{'='*60}")
