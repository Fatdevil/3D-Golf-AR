"""Quick analysis of the downloaded Kristianstad SLS data"""
import laspy
import numpy as np
from pyproj import Transformer

t_inv = Transformer.from_crs("EPSG:3006", "EPSG:4326", always_xy=True)

path = "data/kristianstad_sls/61_4/25A006_619_45_7525.laz"
print(f"Reading {path}...")
laz = laspy.read(path)

xs = np.array(laz.x)
ys = np.array(laz.y)
zs = np.array(laz.z)

# Convert tile center to GPS
cx, cy = (xs.min()+xs.max())/2, (ys.min()+ys.max())/2
lon, lat = t_inv.transform(cx, cy)

print(f"\nTotal points: {len(xs):,}")
print(f"SWEREF: E {xs.min():.0f}-{xs.max():.0f}, N {ys.min():.0f}-{ys.max():.0f}")
print(f"GPS center: {lat:.4f}°N, {lon:.4f}°E")
print(f"Z range: {zs.min():.1f} - {zs.max():.1f} m")

width = xs.max() - xs.min()
depth = ys.max() - ys.min()
area = width * depth
density = len(xs) / area if area > 0 else 0
print(f"Coverage: {width:.0f} x {depth:.0f} m")
print(f"Density: {density:.1f} points/m²")
print(f"Klassificering: Klass 3")

# Classifications
cls = np.array(laz.classification)
unique, counts = np.unique(cls, return_counts=True)
cls_names = {0:'Never classified', 1:'Unclassified', 2:'Ground', 3:'Low veg', 
             4:'Medium veg', 5:'High veg', 6:'Building', 7:'Low point',
             9:'Water', 17:'Bridge', 18:'High noise'}
print(f"\nClassifications:")
for c, n in sorted(zip(unique, counts), key=lambda x:-x[1]):
    name = cls_names.get(c, f'Class {c}')
    print(f"  {c:3d} {name:20s}: {n:>10,} ({n/len(xs)*100:5.1f}%)")

# RGB?
has_rgb = hasattr(laz, 'red') and hasattr(laz, 'green') and hasattr(laz, 'blue')
print(f"\nHas RGB: {'YES' if has_rgb else 'NO'}")

# Kristianstad GK position
kstad_e, kstad_n = 448275, 6209729
dist = ((cx-kstad_e)**2 + (cy-kstad_n)**2)**0.5
print(f"\nDistance to Kristianstad GK: {dist:.0f}m ({dist/1000:.1f}km)")

# Also check the old NNH file
print("\n" + "="*50)
path2 = "data/kristianstad_sls/61_4/19A006_619_45_7525.laz"
print(f"Reading OLD NNH: {path2}...")
laz2 = laspy.read(path2)
xs2, ys2 = np.array(laz2.x), np.array(laz2.y)
density2 = len(xs2) / ((xs2.max()-xs2.min()) * (ys2.max()-ys2.min()))
print(f"NNH points: {len(xs2):,} | Density: {density2:.1f} p/m²")
print(f"SLS points: {len(xs):,} | Density: {density:.1f} p/m²")
print(f"Ratio SLS/NNH: {len(xs)/len(xs2):.1f}x")
