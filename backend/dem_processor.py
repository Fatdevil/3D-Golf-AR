import numpy as np
import laspy
from scipy.interpolate import griddata
import json
import math
import argparse
import os
import requests

def process_lidar_to_dem(input_laz_path, output_json_path, resolution_meters=1.0, cutoff=25):
    """
    Tar in ett extremt tungt rå-punktmoln från t.ex. Lantmäteriet.
    Filtrerar ut träd/skog (Ground classification).
    Bakar ner till en grid/DEM och sparar för webb-appen.
    """
    print(f"Laddar in LiDAR-data från: {input_laz_path}...")
    
    try:
        las = laspy.read(input_laz_path)
    except Exception as e:
        print(f"Kunde inte läsa filen (saknas lazrs?): {e}")
        return False

    print(f"Laddade {len(las.points)} punkter i minnet.")

    # 1. Tvinga filtrering: Bara 'Ground' klassifikationen (klass 2 är nästan alltid mark enligt kodstandard(ASPRS))
    # Om filen saknar klassificering (vilket vissa test-filer gör) kör vi alla punkter
    try:
        ground_points = las.points[las.classification == 2]
        if len(ground_points) < 100: # Säkerhetsnät
            print("Varning: Hittade inga mark-punkter (Klass 2). Använder ALLA punkter (kan bygga kullar av träd!)")
            ground_points = las.points
        else:
            print(f"Filtrerade bort fåglar, träd & hus. Kvarvarande markpunkter: {len(ground_points)}")
    except:
        ground_points = las.points
        print("Kunde inte läsa klassifikation. Använder alla punkter.")

    # === 2. BOUNDING BOX ===
    if args and args.cx and args.cy:
        center_x = args.cx
        center_y = args.cy
        print(f"🎯 Siktar på The Target-Koordinater: X={center_x}, Y={center_y}")
    else:
        # Om inga koordinater ges, plocka mitten av hela filen (The Forest-buggen!)
        center_x = np.mean(ground_points.x)
        center_y = np.mean(ground_points.y)
        print(f"Siktar på Laserns mittpunkt: X={center_x:.1f}, Y={center_y:.1f}")
    
    # Filtrera bort alla punkter utom de inom cutoff från center
    mask = (ground_points.x > center_x - cutoff) & (ground_points.x < center_x + cutoff) & \
           (ground_points.y > center_y - cutoff) & (ground_points.y < center_y + cutoff)
           
    green_points = ground_points[mask]
    
    if len(green_points) == 0:
        green_points = ground_points

    x = green_points.x
    y = green_points.y
    z = green_points.z

    min_x, max_x = np.min(x), np.max(x)
    min_y, max_y = np.min(y), np.max(y)
    
    width_m = max_x - min_x
    depth_m = max_y - min_y
    
    print(f"Dimensions_m: {width_m:.1f}m bred, {depth_m:.1f}m djup")
    
    # Grid storlek (X antal rutor)
    resolution = int(max(width_m, depth_m) / resolution_meters)
    
    grid_x, grid_y = np.mgrid[min_x:max_x:complex(0, resolution+1), 
                              min_y:max_y:complex(0, resolution+1)]
    
    print(f"Interpolerar ett grid på {resolution}x{resolution} resolution...")
    
    # 3. KRYMPT MANGEL: Interpolera rå-punkterna över ett perfekt rutmönster
    # Nearest neighbor fyller i hål om gräset saknar laserträff
    grid_z = griddata((x, y), z, (grid_x, grid_y), method='linear')
    
    # Fyll kvarvarande hål (NaNs) med extrem-närmaste granne
    if np.isnan(grid_z).any():
        grid_z = griddata((x, y), z, (grid_x, grid_y), method='nearest')

    # Hantera extremvärden genom snabb utjämning
    grid_list = []
    
    base_elevation = np.min(grid_z) # Vatten-nivån
    
    # Bygg matrisen som GreenRead-appen läser in
    for iz in range(resolution + 1):
        row = []
        for ix in range(resolution + 1):
            h = grid_z[ix, iz]
            # Spara in bandbredd: Normalisera runt 0 för appen (om det inte e typ storsjöodjuret)
            normalized_h = h - base_elevation 
            row.append(round(float(normalized_h), 4))
        grid_list.append(row)

    payload = {
        "metadata": {
            "source": f"Scanned LiDAR: {os.path.basename(input_laz_path)}",
            "width": width_m,
            "depth": depth_m,
            "resolution": resolution,
            "base_elevation_meters": base_elevation
        },
        "points": grid_list
    }
    
    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f)
        
    print(f"✅ KLART! Maskinen spotttade ur sig data. Sparad i: {output_json_path}")
    print(f"Data-storleken krympte från {os.path.getsize(input_laz_path)/1e6:.1f}MB till {os.path.getsize(output_json_path)/1000:.1f}KB.")

    # 4. TRÄD-EXTRAKTION (The Canopy)
    try:
        print("Söker efter The Canopy...")
        # Vissa filer använder klass 5, andra lägger allt som inte är mark i klass 1
        tree_points = las.points[las.classification == 5]
        if len(tree_points) == 0:
            print("Inga klass 5-träd hittades. Använder Oklassificerade (Klass 1) som Canopy-kandidater...")
            tree_points = las.points[las.classification == 1]
        
        # Samma mask box som för marken
        mask = (tree_points.x > center_x - cutoff) & (tree_points.x < center_x + cutoff) & \
               (tree_points.y > center_y - cutoff) & (tree_points.y < center_y + cutoff)
               
        local_trees = tree_points[mask]
        print(f"Hittade {len(local_trees)} rå-laserträffar som Canopy-kandidater.")
        
        if len(local_trees) > 0:
            trees_list = []
            res_tree = 10.0 # 10 meter grid för att klustra ihop en trädkrona
            
            x_t = local_trees.x
            y_t = local_trees.y
            z_t = local_trees.z
            
            local_tx = x_t - min_x
            local_ty = y_t - min_y
            
            ix = np.floor(local_tx / res_tree).astype(int)
            iy = np.floor(local_ty / res_tree).astype(int)
            
            grid = {}
            for i in range(len(x_t)):
                key = (ix[i], iy[i])
                if key not in grid:
                    grid[key] = []
                grid[key].append(z_t[i])
                
            for key, z_vals in grid.items():
                if len(z_vals) > 5: # Minst 5 laser-träffar för att räknas
                    max_z = np.max(z_vals)
                    
                    # Lägg till ett Random Jitter för att spräcka the Grid-mönster (Organisk Skog!)
                    import random
                    jitter_x = random.uniform(-4.0, 4.0)
                    jitter_y = random.uniform(-4.0, 4.0)
                    
                    cx = (key[0] + 0.5) * res_tree + jitter_x
                    cy = (key[1] + 0.5) * res_tree + jitter_y
                    
                    three_x = cx - width_m / 2
                    three_z = cy - depth_m / 2
                    
                    # Kolla höjden mot marknivån i fairway-datan istället för base_elevation!
                    # Annars plockar vi låga punkter.
                    ix_g = int((cx) / resolution_meters)
                    iy_g = int((cy) / resolution_meters)
                    
                    ix_g = max(0, min(resolution, ix_g))
                    iy_g = max(0, min(resolution, iy_g))
                    
                    ground_z = base_elevation + grid_list[iy_g][ix_g]
                    
                    three_h = max_z - ground_z
                    
                    # Om the Canopy-träffen är mer än 2.5m över marken, är det ett träd/hus
                    if three_h > 2.5:
                        trees_list.append({"x": round(float(three_x), 1), "z": round(float(three_z), 1), "h": round(float(three_h), 1)})
            
            print(f"🌲 Identifierade {len(trees_list)} unika trädkronor!")
            tree_output = output_json_path.replace('fairway', 'trees')
            with open(tree_output, 'w', encoding='utf-8') as f:
                json.dump(trees_list, f)
            print(f"Sparade träd i: {tree_output}")
    except Exception as e:
        print("Inget träd-data kunde extraheras:", e)

    # 5. SATELLITBILD (ESRI World Imagery Draping)
    try:
        print("Pringar satellit för att ladda ner orthofoto över the bounding box...")
        # Ladda ner exakt 1024x1024 pixlar som matchar vår rutbox i SWEREF 99 (EPSG:3006)
        # Url till ESRI REST API för World Imagery
        esri_url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox={min_x},{min_y},{max_x},{max_y}&bboxSR=3006&imageSR=3006&size=1024,1024&format=jpg&f=image"
        
        r = requests.get(esri_url, timeout=10)
        if r.status_code == 200:
            sat_path = output_json_path.replace('.json', '_sat.jpg')
            if 'fairway' in sat_path:
                sat_path = sat_path.replace('fairway', 'sat')
            with open(sat_path, 'wb') as f:
                f.write(r.content)
            print(f"🌍 Satellitbild klistrad! Sparad i: {sat_path}")
        else:
            print("Fel vid satellitnedladdning:", r.status_code)
    except Exception as e:
        print("Kunde inte hämta satellitbild:", e)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='LiDAR DEM Extractor för GreenRead AR')
    parser.add_argument('--input', type=str, required=True, help='Path to target .las or .laz file')
    parser.add_argument('--output', type=str, default='heightmap.json', help='Output JSON path')
    parser.add_argument('--resolution', type=float, default=1.0, help='Resolution i meter')
    parser.add_argument('--radius', type=float, default=25.0, help='Bredd från center (25=50x50, 200=400x400)')
    parser.add_argument('--cx', type=float, default=None, help='Target X coordinate (SWEREF 99)')
    parser.add_argument('--cy', type=float, default=None, help='Target Y coordinate (SWEREF 99)')
    
    args = parser.parse_args()
    
    # Kör extraktionen, pass args genom ett litet fusk i funktionen
    process_lidar_to_dem(args.input, args.output, args.resolution, args.radius)
