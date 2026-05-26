import re

with open('c:/Antigravety projekt/3D-Golf-AR/arcade_hub.html', 'r', encoding='utf-8') as f:
    c = f.read()

# For rendering normal courses (UGC)
c = c.replace(
    '''// Placeholder image support for future captures
        let bgImg = 'https://images.unsplash.com/photo-1593118247619-e2d6f056869e?w=800&q=80';''',
    '''let bgImg = c.cover_image || 'https://images.unsplash.com/photo-1593118247619-e2d6f056869e?w=800&q=80';'''
)

# For rendering my published courses
c = c.replace(
    '''// Placeholder image support for future captures
    let bgImg = 'https://images.unsplash.com/photo-1593118247619-e2d6f056869e?w=800&q=80';''',
    '''let bgImg = 'https://images.unsplash.com/photo-1593118247619-e2d6f056869e?w=800&q=80';'''
) # Wait, they both have similar lines. I'll just use regex to replace all.

c = re.sub(
    r"let bgImg = 'https://images.unsplash.com/[^']+';",
    "let bgImg = c.cover_image || 'https://images.unsplash.com/photo-1593118247619-e2d6f056869e?w=800&q=80';",
    c
)

with open('c:/Antigravety projekt/3D-Golf-AR/arcade_hub.html', 'w', encoding='utf-8') as f:
    f.write(c)

print('Patched arcade_hub.html')
