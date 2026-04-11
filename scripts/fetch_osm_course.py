import urllib.request
import urllib.parse
import json
import os
import math

def haversine(p1, p2):
    R = 6371e3
    lat1, lon1 = math.radians(p1['lat']), math.radians(p1['lng'])
    lat2, lon2 = math.radians(p2['lat']), math.radians(p2['lng'])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

def run():
    print("🚀 Ansluter till OpenStreetMap via Overpass API...")
    # Sök på Valderrama, vi hämtar alla hål, greener, tees och bunkrar inom klubbens area.
    query = """
    [out:json][timeout:25];
    // Valderrama Bounding Box (Syd, Väst, Nord, Öst)
    (
      way["golf"="hole"](36.27,-5.34,36.29,-5.31);
      way["golf"="green"](36.27,-5.34,36.29,-5.31);
      way["golf"="bunker"](36.27,-5.34,36.29,-5.31);
      node["golf"="tee"](36.27,-5.34,36.29,-5.31);
      way["golf"="tee"](36.27,-5.34,36.29,-5.31);
    );
    out geom;
    """
    
    url = "https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(query)
    req = urllib.request.Request(url, headers={'User-Agent': 'GreenReadAR-Fetcher/1.0'})
    
    print("Hämtar GIS-data för hålen, vänligen vänta...")
    try:
        response = urllib.request.urlopen(req)
        data = json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"❌ Något gick fel vid hämtning: {e}")
        return

    elements = data.get('elements', [])
    print(f"✅ Hittade {len(elements)} golf-geometrier på den angivna banan.")
    
    holes = {}
    greens = []
    bunkers = []
    tees = []

    # Processa alla objekt från OSM
    for el in elements:
        tags = el.get('tags', {})
        tipo = tags.get('golf')
        ref = tags.get('ref')
        
        geometry = el.get('geometry', [])
        coords = [{'lat': g['lat'], 'lng': g['lon']} for g in geometry]
        if not coords and el['type'] == 'node':
            coords = [{'lat': el['lat'], 'lng': el['lon']}]
            
        if not coords:
            continue
            
        if tipo == 'hole':
            if ref and ref.isdigit():
                holes[int(ref)] = {
                    'num': int(ref),
                    'name': f"Hole {ref}",
                    'par': int(tags.get('par', 4)),
                    'distance': int(tags.get('distance', 0)),
                    'fairwayLine': coords,
                    'bunkers': [],
                    'si': int(tags.get('handicap', 18))
                }
        elif tipo == 'green':
            centroid = {'lat': sum(c['lat'] for c in coords)/len(coords), 'lng': sum(c['lng'] for c in coords)/len(coords)}
            greens.append({'ref': ref, 'poly': coords, 'center': centroid})
        elif tipo == 'bunker':
            bunkers.append({'poly': coords})
        elif tipo == 'tee':
            centroid = {'lat': sum(c['lat'] for c in coords)/len(coords), 'lng': sum(c['lng'] for c in coords)/len(coords)}
            tees.append({'ref': ref, 'center': centroid})

    # Lägg ihop pusslet (Mappa Tees och Greener till rätt Hole)
    output_holes = []
    for num, h in sorted(holes.items()):
        # Para ihop Tee
        my_tees = [t for t in tees if t['ref'] == str(num)]
        if my_tees:
            h['tee'] = my_tees[-1]['center']
        else:
            h['tee'] = h['fairwayLine'][0] # Fallback till första punkten på dogleg-banan

        # Para ihop Green
        my_greens = [g for g in greens if g['ref'] == str(num)]
        if my_greens:
            h['green'] = my_greens[0]['center']
            h['greenPoly'] = my_greens[0]['poly']
        else:
            # GEOMETRISK SÖKNING: Leta upp greenen närmast slutet på hålet om "ref"-tagg saknas!
            end_point = h['fairwayLine'][-1]
            best_green = None
            best_dist = 999999
            for g in greens:
                dist = haversine(end_point, g['center'])
                if dist < best_dist:
                    best_dist = dist
                    best_green = g
            # Om vi hittade en green inom 50 meter från golf=hole slutet
            if best_green and best_dist < 50:
                h['green'] = best_green['center']
                h['greenPoly'] = best_green['poly']
            else:
                h['green'] = end_point # Borde inte hända, men vi lägger pinnen i bakkant av hålet
                h['greenPoly'] = []

        # Para ihop Bunkrar som ligger runt detta specifika hål (inom 60m från fairway)
        h['bunkers'] = []
        for b in bunkers:
            # Snabb koll, är minsta avståndet mellan nån punkt på bunkern och hålets linje litet?
            dist_to_fairway = min(haversine(bp, fp) for fp in h['fairwayLine'] for bp in b['poly'])
            if dist_to_fairway < 60:
                h['bunkers'].append(b['poly'])

        # Räkna ut Mittpunkt (Fairway target, den nya intelligenta kalkylen)
        h['mid'] = h['fairwayLine'][len(h['fairwayLine']) // 2]
        
        # Beräkna totalt avstånd ifall OSM saknar par/distance
        if h['distance'] == 0:
            h['distance'] = int(haversine(h['tee'], h['green']))

        output_holes.append(h)

    print(f"🏁 Datan pusslad! Genererade array med {len(output_holes)} färdiga hål.")
    
    # Exportera till fil som html-appen kan läsa in
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, 'valderrama.js')
    
    with open(out_file, 'w', encoding='utf-8') as f:
        f.write('// Denna data är helt Auto-genererad från OpenStreetMap av GreenRead-skriptet\n')
        f.write('const HOLES = ' + json.dumps(output_holes, indent=2) + ';\n')
        f.write('console.log("OSM-data Inläst: " + HOLES.length + " hål redo.");\n')
        
    print(f"🎉 SUCCÉ! Fil sparad: {out_file}")
    print(f"TIPS: Länka in den i din HTML-kod med: <script src=\"data/valderrama.js\"></script> istället för att hårdkoda listan.")

if __name__ == '__main__':
    run()
