with open('arcade.html', 'r', encoding='utf-8') as f:
    content = f.read()

bad_string = r'<input type=\"range\" id=\"sb-bunker-depth\" min=\"0.0\" max=\"3.0\"'
good_string = '<input type="range" id="sb-bunker-depth" min="0.0" max="3.0"'

if bad_string in content:
    content = content.replace(bad_string, good_string)
    with open('arcade.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print('SUCCESS')
else:
    print('FAILED TO FIND BAD STRING')
