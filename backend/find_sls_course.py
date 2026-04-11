"""
Find golf courses that fall within SLS Klass 1 blocks.
Klass 1 = highest density (~20-40 points/m²)
"""
from pyproj import Transformer

t = Transformer.from_crs("EPSG:4326", "EPSG:3006", always_xy=True)
t_inv = Transformer.from_crs("EPSG:3006", "EPSG:4326", always_xy=True)

# SLS Klass 1 blocks (from the GeoJSON data the user found)
klass1_blocks = [
    ("25A003", 367500, 412500, 6150000, 6175000),
    ("25A007", 347500, 400000, 6200000, 6225000),
    ("25A010", 425000, 492500, 6200000, 6225000),
    ("25E017", 575000, 635000, 6850000, 6875000),
    ("25E022", 575000, 600000, 6875000, 6925000),
    ("25E023", 600000, 642500, 6875000, 6900000),
    ("25E024", 600000, 642500, 6900000, 6925000),
    ("25E032", 550000, 575000, 6925000, 6975000),
    ("25E033", 575000, 600000, 6925000, 6975000),
    ("25E034", 600000, 625000, 6925000, 6975000),
    ("25E035", 625000, 660000, 6925000, 6950000),
    ("25F010", 550000, 575000, 6975000, 7025000),
    ("25F011", 575000, 600000, 6975000, 7025000),
    ("25F012", 600000, 625000, 6975000, 7025000),
    ("25F013", 625000, 650000, 6975000, 7025000),
    ("25F014", 650000, 690000, 6975000, 7000000),
]

# First show where each Klass 1 block is in GPS coords
print("=" * 70)
print("SLS KLASS 1 BLOCKS — GPS COORDINATES")
print("=" * 70)
for name, min_e, max_e, min_n, max_n in klass1_blocks:
    # Convert center to GPS
    center_e = (min_e + max_e) / 2
    center_n = (min_n + max_n) / 2
    lon, lat = t_inv.transform(center_e, center_n)
    
    # Convert corners for GPS bbox
    lon_sw, lat_sw = t_inv.transform(min_e, min_n)
    lon_ne, lat_ne = t_inv.transform(max_e, max_n)
    
    print(f"\n{name}: Center GPS ~{lat:.2f}°N, {lon:.2f}°E")
    print(f"  SWEREF: E {min_e}-{max_e}, N {min_n}-{max_n}")
    print(f"  GPS box: {lat_sw:.3f}-{lat_ne:.3f}°N, {lon_sw:.3f}-{lon_ne:.3f}°E")

# Now check specific golf courses
print("\n" + "=" * 70)
print("GOLF COURSES IN KLASS 1 AREAS")
print("=" * 70)

courses = [
    # Southern Sweden (25A blocks around lat 55-56)
    ("Barsebäck G&CC", 55.757, 12.903),
    ("Landskrona GK", 55.879, 12.854),
    ("Helsingborgs GK", 56.070, 12.730),
    ("Mölle GK", 56.280, 12.500),
    ("Ringsjö GK", 55.860, 13.520),
    ("Eslövs GK", 55.838, 13.350),
    ("Lunds Akademiska GK", 55.710, 13.220),
    ("Romeleåsens GK", 55.620, 13.480),
    ("Kristianstad GK", 56.030, 14.170),
    ("Ystad GK", 55.430, 13.830),
    ("Simrishamn GK", 55.560, 14.340),
    ("Tomelilla GK", 55.550, 13.960),
    # Try Sundsvall area (25E blocks around lat 62)
    ("Sundsvalls GK", 62.400, 17.310),
    ("Timrå GK", 62.480, 17.320),
    ("Härnösands GK", 62.640, 17.930),
    ("Kramfors GK", 62.930, 17.780),
    ("Ånge GK", 62.528, 15.660),
    # More in Norrland
    ("Sollefteå GK", 63.170, 17.270),
    ("Örnsköldsviks GK", 63.290, 18.710),
]

matches = []
for name, lat, lon in courses:
    e, n = t.transform(lon, lat)
    for block_name, min_e, max_e, min_n, max_n in klass1_blocks:
        if min_e <= e <= max_e and min_n <= n <= max_n:
            matches.append((name, lat, lon, e, n, block_name))
            print(f"\n  ✅ {name}")
            print(f"     GPS: {lat:.3f}, {lon:.3f}")
            print(f"     SWEREF: E={e:.0f}, N={n:.0f}")
            print(f"     Block: {block_name}")
            # Calculate which 2.5km tile
            tile_e = int(e / 2500) * 2500
            tile_n = int(n / 2500) * 2500
            print(f"     Tile: {tile_e}_{tile_n}")

if not matches:
    print("\n  ❌ No matches found in Klass 1 blocks")
    print("\n  Checking closest blocks...")
    for name, lat, lon in courses[:8]:  # Just check southern ones
        e, n = t.transform(lon, lat)
        min_dist = float('inf')
        closest = None
        for block_name, min_e, max_e, min_n, max_n in klass1_blocks:
            # Distance to block
            de = max(0, min_e - e) if e < min_e else max(0, e - max_e)
            dn = max(0, min_n - n) if n < min_n else max(0, n - max_n)
            dist = (de**2 + dn**2)**0.5
            if dist < min_dist:
                min_dist = dist
                closest = block_name
        print(f"  {name}: {min_dist:.0f}m to nearest Klass 1 block ({closest})")
