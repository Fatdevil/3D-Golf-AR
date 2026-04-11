import json
with open('data/pointcloud_hole1.json','r') as f:
    d = json.load(f)
print(f"Count: {d['count']}")
print(f"X range: {min(d['x']):.1f} to {max(d['x']):.1f}")
print(f"Y range: {min(d['y']):.1f} to {max(d['y']):.1f}")
print(f"Z range: {min(d['z']):.1f} to {max(d['z']):.1f}")
# Check how pointcloud builds positions in flyover_v3.html
# positions[i*3] = cloudData.x[i]     => world X
# positions[i*3+1] = cloudData.z[i]   => world Y (elevation)
# positions[i*3+2] = cloudData.y[i]   => world Z
print(f"\nIn Three.js pointcloud mapping:")
print(f"  x[i] -> world X (east), range: {min(d['x']):.1f} to {max(d['x']):.1f}")
print(f"  y[i] -> world Z (depth), range: {min(d['y']):.1f} to {max(d['y']):.1f}")
print(f"  z[i] -> world Y (height), range: {min(d['z']):.1f} to {max(d['z']):.1f}")
