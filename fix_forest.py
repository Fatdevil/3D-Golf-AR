import re

with open('arcade.html', 'r', encoding='utf-8') as f:
    text = f.read()

wrong_insertion = '''                        let type = currentNatureType;
                        if (currentNatureType === 'RANDOM') {
                            let types = ['TREE', 'BUSH', 'PALM', 'OAK', 'OAK2', 'PINE', 'ROCK', 'CACTUS'];
                            type = types[Math.floor(Math.random() * types.length)];
                        }\n'''

text = text.replace(wrong_insertion, '')

old_types = '''                        let types = ['TREE', 'PINE', 'OAK', 'OAK2', 'BUSH', 'ROCK'];
                        let type = types[Math.floor(Math.random() * types.length)];'''

new_types = '''                        let type = window.currentNatureType || 'RANDOM';
                        if (type === 'RANDOM') {
                            let types = ['TREE', 'BUSH', 'PALM', 'OAK', 'OAK2', 'PINE', 'ROCK', 'CACTUS'];
                            type = types[Math.floor(Math.random() * types.length)];
                        }'''

if old_types in text:
    text = text.replace(old_types, new_types)
    with open('arcade.html', 'w', encoding='utf-8') as f:
        f.write(text)
    print("SUCCESS")
else:
    print("COULD NOT FIND OLD TYPES")
