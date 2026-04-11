"""Download satellite imagery for a golf hole using Google Maps tiles."""
from pyproj import Transformer
import urllib.request, math, os, sys
from PIL import Image
from io import BytesIO

to_wgs = Transformer.from_crs("EPSG:3006", "EPSG:4326", always_xy=False)
cx, cy = 753708.40, 7069566.43
r = 250

sw_lat, sw_lon = to_wgs.transform(cy - r, cx - r)
ne_lat, ne_lon = to_wgs.transform(cy + r, cx + r)
print(f"Bounds: {sw_lat:.5f},{sw_lon:.5f} to {ne_lat:.5f},{ne_lon:.5f}")

zoom = 18

def ll2tile(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    lr = math.radians(lat)
    y = int((1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n)
    return x, y

def tile2ll(tx, ty, z):
    n = 2 ** z
    lon = tx / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / n))))
    return lat, lon

tx0, ty0 = ll2tile(ne_lat, sw_lon, zoom)
tx1, ty1 = ll2tile(sw_lat, ne_lon, zoom)
print(f"Tiles: ({tx0},{ty0}) to ({tx1},{ty1})")

cols = tx1 - tx0 + 1
rows = ty1 - ty0 + 1
print(f"Grid: {cols}x{rows} = {cols * rows} tiles")

img = Image.new("RGB", (cols * 256, rows * 256))
for tx in range(tx0, tx1 + 1):
    for ty in range(ty0, ty1 + 1):
        server = (tx + ty) % 4
        url = f"https://mt{server}.google.com/vt/lyrs=s&x={tx}&y={ty}&z={zoom}"
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            with urllib.request.urlopen(req, timeout=15) as resp:
                tdata = resp.read()
            tile = Image.open(BytesIO(tdata))
            img.paste(tile, ((tx - tx0) * 256, (ty - ty0) * 256))
            print(f"  Tile {tx},{ty} OK ({len(tdata) // 1024}KB)")
        except Exception as e:
            print(f"  Tile {tx},{ty} FAILED: {e}")

# Crop to exact extent
tl = tile2ll(tx0, ty0, zoom)
br = tile2ll(tx1 + 1, ty1 + 1, zoom)
W = cols * 256
H = rows * 256
px_l = int((sw_lon - tl[1]) / (br[1] - tl[1]) * W)
px_r = int((ne_lon - tl[1]) / (br[1] - tl[1]) * W)
px_t = int((tl[0] - ne_lat) / (tl[0] - br[0]) * H)
px_b = int((tl[0] - sw_lat) / (tl[0] - br[0]) * H)
print(f"Crop: ({px_l},{px_t}) to ({px_r},{px_b})")

cropped = img.crop((px_l, px_t, px_r, px_b)).resize((2048, 2048), Image.LANCZOS)
outpath = "data/satellite_hole1.jpg"
cropped.save(outpath, quality=92)
print(f"Saved: {outpath} ({os.path.getsize(outpath) // 1024} KB)")
