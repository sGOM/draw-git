#!/usr/bin/env python3
"""index.html 의 <link href=*.css> / <script src=*.js> 를 통째로 박아 dist.html 로.
Artifact 는 파일 하나만 올리므로 퍼블리시 전에 이걸 돌린다."""
import io, re, sys, pathlib

root = pathlib.Path(__file__).parent
read = lambda p: io.open(root / p, encoding="utf-8").read()

def inline(m):
    path, tag = (m.group("css"), "style") if m.group("css") else (m.group("js"), "script")
    return "<%s>\n%s\n</%s>" % (tag, read(path).strip(), tag)

html = re.sub(
    r'<link rel="stylesheet" href="(?P<css>[^":]+)">|<script src="(?P<js>[^"]+)"></script>',
    inline, read("index.html"))

io.open(root / "dist.html", "w", encoding="utf-8", newline="\n").write(html)
print("dist.html  %d KB" % (len(html.encode()) // 1024))
