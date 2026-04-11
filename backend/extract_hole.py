"""
GreenRead AR — LiDAR Hole Extractor v2
Uses pyproj for correct SWEREF99 TM ↔ WGS84 transforms.
Extracts terrain, trees, water, and buildings from Lantmäteriet data.
Outputs a single JSON optimized for Three.js rendering.
"""
import argparse, json, sys, os
import numpy as np
import laspy
from pyproj import Transformer
from scipy.interpolate import griddata
from scipy.ndimage import gaussian_filter

# SWEREF99 TM (EPSG:3006) ↔ WGS84 (EPSG:4326)
to_sweref = Transformer.from_crs("EPSG:4326", "EPSG:3006", always_xy=False)
to_wgs84 = Transformer.from_crs("EPSG:3006", "EPSG:4326", always_xy=False)

def gps_to_sweref(lat, lon):
    """WGS84 lat/lon → SWEREF99 TM easting/northing"""
    n, e = to_sweref.transform(lat, lon)
    return e, n

def extract_hole(laz_path, tee_lat, tee_lon, green_lat, green_lon, radius=250, resolution=200):
    """Extract a single hole from LiDAR data, centered on the fairway midpoint."""
    
    # Convert GPS to SWEREF99
    tee_e, tee_n = gps_to_sweref(tee_lat, tee_lon)
    green_e, green_n = gps_to_sweref(green_lat, green_lon)
    
    # Center = midpoint of tee and green
    cx = (tee_e + green_e) / 2
    cy = (tee_n + green_n) / 2
    
    print(f"Tee SWEREF99: E={tee_e:.2f}, N={tee_n:.2f}")
    print(f"Green SWEREF99: E={green_e:.2f}, N={green_n:.2f}")
    print(f"Center: E={cx:.2f}, N={cy:.2f}")
    print(f"Tee→Green distance: {np.sqrt((tee_e-green_e)**2 + (tee_n-green_n)**2):.1f}m")
    
    # Three.js coordinates (relative to center)
    tee_3d = (tee_e - cx, tee_n - cy)
    green_3d = (green_e - cx, green_n - cy)
    print(f"\nThree.js tee:   ({tee_3d[0]:.1f}, {tee_3d[1]:.1f})")
    print(f"Three.js green: ({green_3d[0]:.1f}, {green_3d[1]:.1f})")
    
    # Load LiDAR
    print(f"\nLoading {laz_path}...")
    las = laspy.read(laz_path)
    print(f"Total points: {len(las.points):,}")
    
    # Crop to bounding box
    mask = (
        (las.x >= cx - radius) & (las.x <= cx + radius) &
        (las.y >= cy - radius) & (las.y <= cy + radius)
    )
    x = np.array(las.x[mask])
    y = np.array(las.y[mask])
    z = np.array(las.z[mask])
    cls = np.array(las.classification[mask])
    print(f"Points in bbox ({radius*2}x{radius*2}m): {len(x):,}")
    
    # ======== GROUND TERRAIN ========
    ground_mask = cls == 2
    gx = x[ground_mask] - cx
    gy = y[ground_mask] - cy
    gz = z[ground_mask]
    
    base_elevation = float(np.percentile(gz, 5)) if len(gz) > 0 else 0
    gz_rel = gz - base_elevation
    
    print(f"Ground points: {len(gx):,}, base elevation: {base_elevation:.1f}m")
    
    # Create terrain grid
    grid_x = np.linspace(-radius, radius, resolution)
    grid_y = np.linspace(-radius, radius, resolution)
    gx_grid, gy_grid = np.meshgrid(grid_x, grid_y)
    
    # Subsample for speed if too many points
    if len(gx) > 200000:
        idx = np.random.choice(len(gx), 200000, replace=False)
        gx_s, gy_s, gz_s = gx[idx], gy[idx], gz_rel[idx]
    else:
        gx_s, gy_s, gz_s = gx, gy, gz_rel
    
    terrain = griddata(
        np.column_stack([gx_s, gy_s]), gz_s,
        (gx_grid, gy_grid), method='linear', fill_value=float(np.mean(gz_rel))
    )
    terrain = gaussian_filter(terrain, sigma=1.0)
    terrain_list = np.round(terrain, 2).tolist()
    
    # ======== VEGETATION (TREES) ========
    # Class 1 (unclassified) contains vegetation in "skog" product
    veg_mask = cls == 1
    vx = x[veg_mask] - cx
    vy = y[veg_mask] - cy
    vz = z[veg_mask] - base_elevation
    
    print(f"Vegetation points: {len(vx):,}")
    
    # Cluster vegetation into individual trees using grid-based approach
    tree_grid_res = 3  # 3m grid cells
    trees = []
    if len(vx) > 0:
        # Create a grid and find peaks
        grid_bins_x = np.arange(-radius, radius + tree_grid_res, tree_grid_res)
        grid_bins_y = np.arange(-radius, radius + tree_grid_res, tree_grid_res)
        
        for i in range(len(grid_bins_x) - 1):
            for j in range(len(grid_bins_y) - 1):
                cell_mask = (
                    (vx >= grid_bins_x[i]) & (vx < grid_bins_x[i+1]) &
                    (vy >= grid_bins_y[j]) & (vy < grid_bins_y[j+1])
                )
                cell_z = vz[cell_mask]
                if len(cell_z) < 3:
                    continue
                
                max_z = float(np.max(cell_z))
                # Get ground height at this position
                gx_pos = (grid_bins_x[i] + grid_bins_x[i+1]) / 2
                gy_pos = (grid_bins_y[j] + grid_bins_y[j+1]) / 2
                
                gi = int((gx_pos + radius) / (2 * radius) * (resolution - 1))
                gj = int((gy_pos + radius) / (2 * radius) * (resolution - 1))
                gi = max(0, min(resolution - 1, gi))
                gj = max(0, min(resolution - 1, gj))
                ground_h = terrain[gj][gi]
                
                tree_height = max_z - ground_h
                if tree_height > 3:  # Only trees taller than 3m
                    trees.append({
                        'x': round(gx_pos, 1),
                        'z': round(gy_pos, 1),
                        'h': round(tree_height, 1),
                        'g': round(ground_h, 1)  # ground height
                    })
    
    print(f"Trees detected: {len(trees)}")
    
    # ======== WATER ========
    water_mask = cls == 9
    water_areas = []
    if np.sum(water_mask) > 100:
        wx = x[water_mask] - cx
        wy = y[water_mask] - cy
        # Find water boundary as convex hull simplified to bbox
        water_areas.append({
            'min_x': round(float(np.min(wx)), 1),
            'max_x': round(float(np.max(wx)), 1),
            'min_z': round(float(np.min(wy)), 1),
            'max_z': round(float(np.max(wy)), 1),
            'elevation': round(float(np.mean(z[water_mask])) - base_elevation, 1)
        })
        print(f"Water area found: {len(z[water_mask]):,} points")
    
    # ======== BUILDINGS (class 6) ========
    bldg_mask = cls == 6
    buildings = []
    if np.sum(bldg_mask) > 10:
        bx = x[bldg_mask] - cx
        by = y[bldg_mask] - cy
        bz = z[bldg_mask] - base_elevation
        # Simple clustering by grid
        for i in range(len(grid_bins_x) - 2):
            for j in range(len(grid_bins_y) - 2):
                cell_mask = (
                    (bx >= grid_bins_x[i]) & (bx < grid_bins_x[i+2]) &
                    (by >= grid_bins_y[j]) & (by < grid_bins_y[j+2])
                )
                if np.sum(cell_mask) > 5:
                    buildings.append({
                        'x': round(float(np.mean(bx[cell_mask])), 1),
                        'z': round(float(np.mean(by[cell_mask])), 1),
                        'w': round(float(np.ptp(bx[cell_mask])), 1),
                        'd': round(float(np.ptp(by[cell_mask])), 1),
                        'h': round(float(np.max(bz[cell_mask]) - np.min(bz[cell_mask])), 1)
                    })
        print(f"Buildings detected: {len(buildings)}")
    
    # ======== OUTPUT ========
    output = {
        'metadata': {
            'source': os.path.basename(laz_path),
            'width': radius * 2,
            'depth': radius * 2,
            'resolution': resolution,
            'base_elevation_meters': round(base_elevation, 2),
            'center_sweref99': {'e': round(cx, 2), 'n': round(cy, 2)},
            'tee_3d': {'x': round(tee_3d[0], 1), 'z': round(tee_3d[1], 1)},
            'green_3d': {'x': round(green_3d[0], 1), 'z': round(green_3d[1], 1)},
            'tee_gps': {'lat': tee_lat, 'lon': tee_lon},
            'green_gps': {'lat': green_lat, 'lon': green_lon},
        },
        'points': terrain_list,
        'trees': trees,
        'water': water_areas,
        'buildings': buildings

    }
    
    return output

def main():
    parser = argparse.ArgumentParser(description='Extract golf hole from LiDAR')
    parser.add_argument('--input', required=True, help='Path to .laz file')
    parser.add_argument('--output', required=True, help='Output JSON path')
    parser.add_argument('--tee-lat', type=float, required=True)
    parser.add_argument('--tee-lon', type=float, required=True)
    parser.add_argument('--green-lat', type=float, required=True)
    parser.add_argument('--green-lon', type=float, required=True)
    parser.add_argument('--radius', type=int, default=250, help='Radius in meters')
    parser.add_argument('--resolution', type=int, default=200, help='Grid resolution')
    args = parser.parse_args()
    
    data = extract_hole(
        args.input,
        args.tee_lat, args.tee_lon,
        args.green_lat, args.green_lon,
        args.radius, args.resolution
    )
    
    with open(args.output, 'w') as f:
        json.dump(data, f)
    
    size_kb = os.path.getsize(args.output) / 1024
    print(f"\n✅ Saved to {args.output} ({size_kb:.0f} KB)")
    print(f"   Trees: {len(data['trees'])}, Water areas: {len(data['water'])}, Buildings: {len(data['buildings'])}")

if __name__ == '__main__':
    main()
