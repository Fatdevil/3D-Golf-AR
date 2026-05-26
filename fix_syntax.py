import os

arcade_path = 'c:/Antigravety projekt/3D-Golf-AR/arcade.html'
with open(arcade_path, 'r', encoding='utf-8') as f:
    c = f.read()

# Replace literal \n\n with actual new lines and add the missing };
target_string = r'\n\n        function executeSmartBuilder() {'
replacement_string = '\n    };\n\n        function executeSmartBuilder() {'

if target_string in c:
    c = c.replace(target_string, replacement_string)
    with open(arcade_path, 'w', encoding='utf-8') as f:
        f.write(c)
    print("Syntax error fixed successfully")
else:
    print("Target string not found")
