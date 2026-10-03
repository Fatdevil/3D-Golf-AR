#!/usr/bin/env python3
"""Cuts a block of lines out of the big inline script in arcade.html into its own file, on the very same spot.

  python3 tools/split-script.py cut NAME.js --start "<exact first line>" --end "<exact last line>" [--end-after "<anchor>"]
  python3 tools/split-script.py verify [BASE_REF]       (default origin/main)

`cut` replaces the lines with
    </script>
    <script src="NAME.js?v=1"></script>
    <script>
so the code runs in exactly the same order as before (classic scripts share the global scope, so top-level let/const stay visible).
Lines are matched by their exact text (indentation included); the start line must be unique. Nothing is re-indented.

`verify` proves a split changed nothing: it puts every extracted file back into arcade.html and compares the result, byte for byte,
with arcade.html at BASE_REF (itself expanded the same way, so earlier splits already on BASE_REF are fine).
"""
import re
import subprocess
import sys

HTML = 'arcade.html'
MARK = re.compile(r'</script>\n<script src="([A-Za-z0-9_.-]+\.js)\?v=\d+"></script>\n<script>\n')


def read(path):
    with open(path, encoding='utf-8', newline='') as f:
        return f.read()


def git_show(ref, path):
    return subprocess.run(['git', 'show', ref + ':' + path], check=True, capture_output=True).stdout.decode('utf-8')


def expand(html, reader):
    """Puts the extracted files back where the markers are."""
    return MARK.sub(lambda m: reader(m.group(1)), html)


def cut(name, start, end, end_after=None):
    html = read(HTML)
    lines = html.split('\n')
    starts = [i for i, l in enumerate(lines) if l.rstrip() == start.rstrip()]
    if len(starts) != 1:
        sys.exit('start line must match exactly one line, found %d' % len(starts))
    s = starts[0]
    e = None
    for i in range(s, len(lines)):
        if lines[i].rstrip() == end.rstrip():
            e = i
            break
    if e is None:
        sys.exit('end line not found after the start line')
    if end_after:
        # take the last match of `end` that still comes before the first line equal to end_after
        stop = next((i for i in range(s, len(lines)) if lines[i].rstrip() == end_after.rstrip()), None)
        if stop is None:
            sys.exit('--end-after line not found')
        e = max(i for i in range(s, stop) if lines[i].rstrip() == end.rstrip())
    block = lines[s:e + 1]
    if any('</script' in l for l in block):
        sys.exit('the block contains a </script> tag, cannot be moved')
    content = '\n'.join(block) + '\n'
    try:
        existing = read(name)
        sys.exit('%s already exists' % name)
    except FileNotFoundError:
        pass
    with open(name, 'w', encoding='utf-8', newline='') as f:
        f.write(content)
    marker = ['</script>', '<script src="%s?v=1"></script>' % name, '<script>']
    new = lines[:s] + marker + lines[e + 1:]
    with open(HTML, 'w', encoding='utf-8', newline='') as f:
        f.write('\n'.join(new))
    print('%s: %d lines (%d-%d) moved out of %s' % (name, len(block), s + 1, e + 1, HTML))


def verify(ref):
    now = expand(read(HTML), read)
    base = expand(git_show(ref, HTML), lambda n: git_show(ref, n) if _exists(ref, n) else read(n))
    if now == base:
        print('OK: arcade.html with all extracted files put back is byte-identical to %s (%d bytes)' % (ref, len(now)))
        return 0
    a, b = now.split('\n'), base.split('\n')
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            print('DIFFERENT at line %d:\n  now : %r\n  base: %r' % (i + 1, x[:120], y[:120]))
            break
    else:
        print('DIFFERENT: lengths %d vs %d lines' % (len(a), len(b)))
    return 1


def _exists(ref, path):
    return subprocess.run(['git', 'cat-file', '-e', ref + ':' + path], capture_output=True).returncode == 0


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('cut'); c.add_argument('name'); c.add_argument('--start', required=True); c.add_argument('--end', required=True); c.add_argument('--end-after')
    v = sub.add_parser('verify'); v.add_argument('ref', nargs='?', default='origin/main')
    a = ap.parse_args()
    if a.cmd == 'cut':
        cut(a.name, a.start, a.end, a.end_after)
    else:
        sys.exit(verify(a.ref))
