import re

with open('arcade.css', 'r', encoding='utf-8') as f:
    css = f.read()

new_css_title = '.hb-section-title { color: #94a3b8; font-size: 12px; font-weight: bold; text-transform: uppercase; margin-top: 15px; border-bottom: 1px solid #334155; padding-bottom: 5px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none; transition: color 0.2s; }\n.hb-section-title:hover { color: #e2e8f0; }\n.hb-section-content { display: none; overflow: hidden; margin-top: 5px; }'

css = re.sub(r'\.hb-section-title\s*\{[^}]+\}', new_css_title, css)
with open('arcade.css', 'w', encoding='utf-8') as f:
    f.write(css)


with open('arcade.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Insert the JS function
js_func = '''
<script>
function toggleHbSection(el) {
    let content = el.nextElementSibling;
    let span = el.querySelector('span');
    if (content.style.display === 'none' || content.style.display === '') {
        content.style.display = 'block';
        if(span) span.style.transform = 'rotate(0deg)';
    } else {
        content.style.display = 'none';
        if(span) span.style.transform = 'rotate(-90deg)';
    }
}
</script>
'''
if 'function toggleHbSection' not in html:
    html = html.replace('</body>', js_func + '\n</body>')

# Split by section titles
parts = re.split(r'<div class="hb-section-title">(.*?)</div>', html)

if len(parts) > 1:
    new_html = parts[0]
    for i in range(1, len(parts), 2):
        title = parts[i]
        content = parts[i+1]
        
        # If it's the last section, we need to close the div before the hamburger menu ends
        if i == len(parts) - 2:
            # find the end of hamburger menu (</div> right before <!-- NEW DYNAMIC HUD -->)
            end_idx = content.find('<!-- NEW DYNAMIC HUD -->')
            if end_idx != -1:
                # Find the last </div> before <!-- NEW DYNAMIC HUD -->
                last_div_idx = content.rfind('</div>', 0, end_idx)
                if last_div_idx != -1:
                    content = content[:last_div_idx] + '</div>\n      </div>' + content[last_div_idx+6:]
        else:
            # Just close the section before the next title
            content = content + '</div>'
            
        new_html += f'<div class="hb-section-title" onclick="toggleHbSection(this)">{title} <span style="transition: transform 0.2s; display: inline-block; transform: rotate(-90deg);">?</span></div>\n<div class="hb-section-content">' + content

    with open('arcade.html', 'w', encoding='utf-8') as f:
        f.write(new_html)
    print("SUCCESS")
else:
    print("NO SECTIONS FOUND")

