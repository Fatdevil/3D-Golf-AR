"""
Analyze both the old NNH and new SLS .laz files to compare density and coverage.
Find which one covers Eslövs GK and show the difference in point density.
"""
import laspy
import numpy as np
from pyproj import Transformer

# WGS84 -> SWEREF 99 TM
t84_sweref = Transformer.from_crs("EPSG:4326", "EPSG:3006", always_xy=True)

# Eslövs GK approximate coordinates
eslov_lat, eslov_lon = 55.838, 13.350
eslov_e, eslov_n = t84_sweref.transform(eslov_lon, eslov_lat)
print(f"Eslövs GK GPS: {eslov_lat}, {eslov_lon}")
print(f"Eslövs GK SWEREF: E={eslov_e:.1f}, N={eslov_n:.1f}")

files = [
    ("data/61_3/18A005_618_39_5025.laz", "NNH (old)"),
    ("data/61_3/25A005_618_39_5025.laz", "SLS Gen3 (new)"),
]

for path, label in files:
    print(f"\n{'='*60}")
    print(f"  {label}: {path}")
    print(f"{'='*60}")
    
    try:
        laz = laspy.read(path)
        xs = np.array(laz.x)
        ys = np.array(laz.y)
        zs = np.array(laz.z)
        
        print(f"  Total points: {len(xs):,}")
        print(f"  X (East) range:  {xs.min():.1f} — {xs.max():.1f}")
        print(f"  Y (North) range: {ys.min():.1f} — {ys.max():.1f}")
        print(f"  Z (Height) range: {zs.min():.1f} — {zs.max():.1f}")
        
        width = xs.max() - xs.min()
        depth = ys.max() - ys.min()
        area = width * depth
        density = len(xs) / area if area > 0 else 0
        print(f"  Coverage: {width:.0f}m × {depth:.0f}m = {area/1e6:.2f} km²")
        print(f"  Density: {density:.1f} points/m²")
        
        # Check if Eslöv GK is within bounds
        if xs.min() <= eslov_e <= xs.max() and ys.min() <= eslov_n <= ys.max():
            print(f"  ✅ Eslövs GK IS within this tile!")
        else:
            dx = min(abs(eslov_e - xs.min()), abs(eslov_e - xs.max()))
            dy = min(abs(eslov_n - ys.min()), abs(eslov_n - ys.max()))
            print(f"  ❌ Eslövs GK is NOT in this tile (distance: ~{max(dx,dy):.0f}m)")
        
        # Classification breakdown
        if hasattr(laz, 'classification'):
            cls = np.array(laz.classification)
            unique, counts = np.unique(cls, return_counts=True)
            print(f"\n  Point classifications:")
            cls_names = {
                0: 'Never classified',
                1: 'Unclassified', 
                2: 'Ground',
                3: 'Low vegetation',
                4: 'Medium vegetation',
                5: 'High vegetation',
                6: 'Building',
                7: 'Low point',
                8: 'Reserved/Model key',
                9: 'Water',
                10: 'Rail',
                11: 'Road surface',
                12: 'Reserved',
                13: 'Wire - Guard',
                14: 'Wire - Conductor',
                15: 'Transmission tower',
                17: 'Bridge deck',
                18: 'High noise',
            }
            for c, n in sorted(zip(unique, counts), key=lambda x: -x[1]):
                name = cls_names.get(c, f'Class {c}')
                pct = n / len(xs) * 100
                print(f"    {c:3d} {name:25s}: {n:>10,} ({pct:5.1f}%)")
        
        # Check if it has RGB/color info
        has_rgb = hasattr(laz, 'red') and hasattr(laz, 'green') and hasattr(laz, 'blue')
        print(f"\n  Has RGB color: {'✅ YES' if has_rgb else '❌ No'}")
        if has_rgb:
            r = np.array(laz.red)
            g = np.array(laz.green)
            b = np.array(laz.blue)
            print(f"    R range: {r.min()} — {r.max()}")
            print(f"    G range: {g.min()} — {g.max()}")
            print(f"    B range: {b.min()} — {b.max()}")
            
    except Exception as e:
        print(f"  ERROR: {e}")

print(f"\n{'='*60}")
print("SUMMARY")
print(f"{'='*60}")
print("If SLS has RGB + high density, we can render a photorealistic")
print("3D scene WITHOUT satellite imagery!")
