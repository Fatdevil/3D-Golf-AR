arcade_path = 'c:/Antigravety projekt/3D-Golf-AR/arcade.html'
with open(arcade_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find and remove the protection block (lines containing the protect logic)
start_idx = None
end_idx = None
for i, line in enumerate(lines):
    if 'Protect Smart Green/Tee zones from being painted over' in line:
        start_idx = i
    if start_idx and 'return;' in line and i > start_idx:
        # Find the closing brace after return
        for j in range(i+1, min(i+3, len(lines))):
            if '}' in lines[j] and 'surfCheck' not in lines[j]:
                end_idx = j
                break
        break

if start_idx is not None and end_idx is not None:
    print(f"Removing lines {start_idx+1} to {end_idx+1}")
    del lines[start_idx:end_idx+1]
    with open(arcade_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print("Paint protection removed!")
else:
    print(f"Could not find protection block. start={start_idx}, end={end_idx}")
