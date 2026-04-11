"""
Process SLS Klass 1 data into 3D-renderable JSON for Three.js
Uses intensity for brightness and classification for color
Multi-return data creates rich 3D tree canopy visualization
"""
import laspy
import numpy as np
import json
from pyproj import Transformer

print("Reading SLS Klass 1 data...")
laz = laspy.read("data/sundsvall_sls/69_6/25E024_690_62_7525.laz")

xs = np.array(laz.x)
ys = np.array(laz.y) 
zs = np.array(laz.z)
cls = np.array(laz.classification)
intensity = np.array(laz.intensity)
num_returns = np.array(laz.number_of_returns)
return_number = np.array(laz.return_number)

print(f"Total points: {len(xs):,}")
print(f"SWEREF bounds: E {xs.min():.0f}-{xs.max():.0f}, N {ys.min():.0f}-{ys.max():.0f}")

# Full tile is 2500x2500m = 6.25 km²
# For browser performance, take a 600x600m subset from the center
center_e = (xs.min() + xs.max()) / 2
center_n = (ys.min() + ys.max()) / 2
half_size = 300  # 600m x 600m area

mask_area = (
    (xs >= center_e - half_size) & (xs <= center_e + half_size) &
    (ys >= center_n - half_size) & (ys <= center_n + half_size)
)

sub_x = xs[mask_area]
sub_y = ys[mask_area]
sub_z = zs[mask_area]
sub_cls = cls[mask_area]
sub_int = intensity[mask_area]
sub_nr = num_returns[mask_area]
sub_rn = return_number[mask_area]

print(f"\nSubset (600x600m center): {len(sub_x):,} points")
sub_density = len(sub_x) / (600*600)
print(f"Subset density: {sub_density:.1f} p/m²")

# Normalize to local coordinates (center at 0,0)
local_x = sub_x - center_e  # East-West
local_y = sub_z.copy()       # Height (elevation)
local_z = sub_y - center_n  # North-South

# Ground height reference
ground_mask = sub_cls == 2
if ground_mask.sum() > 0:
    ground_median = np.median(sub_z[ground_mask])
    local_y = local_y - ground_median  # Normalize height to ground level
    print(f"Ground median height: {ground_median:.1f}m (subtracted)")

# Normalize intensity to 0-1
int_norm = (sub_int.astype(float) - sub_int.min()) / (sub_int.max() - sub_int.min() + 1e-6)

# Assign colors based on classification + height + intensity
# Ground (2) = earthy brown/green
# Unclassified (1) = green shades (vegetation) based on height
# Water (9) = blue
colors_r = np.zeros(len(sub_x), dtype=np.float32)
colors_g = np.zeros(len(sub_x), dtype=np.float32)
colors_b = np.zeros(len(sub_x), dtype=np.float32)

# Ground points - earthy green/brown, intensity affects brightness
gm = sub_cls == 2
brightness = 0.3 + 0.5 * int_norm[gm]
colors_r[gm] = brightness * 0.35
colors_g[gm] = brightness * 0.55
colors_b[gm] = brightness * 0.20

# Vegetation/Unclassified - green with height-based variation
vm = sub_cls == 1
if vm.sum() > 0:
    veg_height = local_y[vm]
    # Low vegetation (0-2m) = bright green
    # Medium (2-8m) = medium green  
    # High canopy (8m+) = dark green
    height_factor = np.clip(veg_height / 25.0, 0, 1)
    veg_brightness = 0.3 + 0.5 * int_norm[vm]
    colors_r[vm] = veg_brightness * (0.15 + 0.15 * height_factor)
    colors_g[vm] = veg_brightness * (0.7 - 0.2 * height_factor)
    colors_b[vm] = veg_brightness * (0.1 + 0.1 * height_factor)

# Water - blue
wm = sub_cls == 9
colors_r[wm] = 0.1
colors_g[wm] = 0.3
colors_b[wm] = 0.7

# Downsample for browser (max ~500k points for smooth performance)
max_points = 500000
if len(sub_x) > max_points:
    # Keep ALL ground points, subsample vegetation
    ground_idx = np.where(ground_mask)[0]
    veg_idx = np.where(~ground_mask)[0]
    
    remaining = max_points - len(ground_idx)
    if remaining > 0 and len(veg_idx) > remaining:
        veg_sample = np.random.choice(veg_idx, remaining, replace=False)
        keep_idx = np.concatenate([ground_idx, veg_sample])
    else:
        keep_idx = np.arange(len(sub_x))
    
    np.random.shuffle(keep_idx)
    keep_idx = np.sort(keep_idx)
    
    local_x = local_x[keep_idx]
    local_y = local_y[keep_idx]
    local_z = local_z[keep_idx]
    colors_r = colors_r[keep_idx]
    colors_g = colors_g[keep_idx]
    colors_b = colors_b[keep_idx]
    sub_cls_final = sub_cls[keep_idx]
    print(f"Downsampled to {len(keep_idx):,} points (kept all ground)")
else:
    sub_cls_final = sub_cls

# Build output JSON
# Positions as flat array [x,y,z, x,y,z, ...]
positions = np.column_stack([local_x, local_y, local_z]).astype(np.float32)
colors = np.column_stack([colors_r, colors_g, colors_b]).astype(np.float32)

# Stats
n_ground = (sub_cls_final == 2).sum()
n_veg = (sub_cls_final == 1).sum()
n_water = (sub_cls_final == 9).sum()

output = {
    "metadata": {
        "source": "Lantmäteriet SLS Gen3 Klass 1",
        "block": "25E024",
        "tile": "690_62_7525", 
        "total_points_in_file": int(len(xs)),
        "rendered_points": int(len(local_x)),
        "density_pm2": round(sub_density, 1),
        "area_m": 600,
        "center_sweref": [float(center_e), float(center_n)],
        "ground_points": int(n_ground),
        "vegetation_points": int(n_veg),
        "water_points": int(n_water),
    },
    "positions": positions.flatten().tolist(),
    "colors": colors.flatten().tolist(),
}

out_path = "data/sundsvall_klass1.json"
print(f"\nWriting {out_path}...")
with open(out_path, 'w') as f:
    json.dump(output, f)

file_size = len(json.dumps(output)) / 1024 / 1024
print(f"Output size: {file_size:.1f} MB")
print(f"\nPoints breakdown:")
print(f"  Ground:     {n_ground:,}")
print(f"  Vegetation: {n_veg:,}")
print(f"  Water:      {n_water:,}")
print(f"  Total:      {len(local_x):,}")

# Also compute a GPS coordinate for reference
t_inv = Transformer.from_crs("EPSG:3006", "EPSG:4326", always_xy=True)
lon, lat = t_inv.transform(center_e, center_n)
print(f"\nCenter GPS: {lat:.5f}°N, {lon:.5f}°E")
print(f"Google Maps: https://www.google.com/maps/@{lat},{lon},17z/data=!3m1!1e3")
print(f"\n✅ Ready for 3D rendering!")
