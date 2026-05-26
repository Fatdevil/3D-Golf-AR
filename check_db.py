import urllib.request
import json

try:
    url = 'http://localhost:3000/api/assets'
    req = urllib.request.urlopen(url, timeout=5)
    data = json.loads(req.read())
    for a in data:
        print(f"ID: {a.get('id')}, category: {a.get('category')!r}, subcategory: {a.get('subcategory')!r}")
except Exception as e:
    print(f"Error: {e}")
