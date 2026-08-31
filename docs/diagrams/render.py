"""Renders the architecture diagrams to docs/img, one SVG per theme.

Run with `python3 docs/diagrams/render.py` from anywhere. Overwrites the four
files it generates.
"""
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "img")
os.makedirs(OUT, exist_ok=True)

FONT = "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"

LIGHT = dict(
    canvas="#ffffff", ext="#64748b", ext_s="#475569", svc="#0f766e", svc_s="#0b5551",
    db="#4338ca", db_s="#312e9e", ok="#047857", ok_s="#036049", bad="#be123c", bad_s="#9f1239",
    gate="#1e293b", gate_s="#475569", node_text="#ffffff", edge="#64748b", edge_async="#6366f1",
    label="#334155", title="#0f172a", muted="#64748b", frame="#cbd5e1",
)
DARK = dict(
    canvas="#0d1117", ext="#475569", ext_s="#64748b", svc="#0d9488", svc_s="#14b8a6",
    db="#4f46e5", db_s="#6366f1", ok="#059669", ok_s="#10b981", bad="#e11d48", bad_s="#fb7185",
    gate="#1e293b", gate_s="#64748b", node_text="#f8fafc", edge="#94a3b8", edge_async="#a5b4fc",
    label="#cbd5e1", title="#f1f5f9", muted="#94a3b8", frame="#30363d",
)


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def head(w, h, p):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" font-family="{FONT}">
<defs>
<marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M0,1 L9,5 L0,9 z" fill="{p['edge']}"/></marker>
<marker id="b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M0,1 L9,5 L0,9 z" fill="{p['edge_async']}"/></marker>
</defs>
<rect width="{w}" height="{h}" fill="{p['canvas']}"/>'''


def node(x, y, w, h, lines, fill, stroke, p, r=10, sub_from=1):
    """Rounded box with a bold first line and smaller following lines."""
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>']
    cx, n = x + w / 2, len(lines)
    start = y + h / 2 - (n - 1) * 10.5
    for i, ln in enumerate(lines):
        size, weight, op = (15, 600, 1) if i < sub_from else (12.5, 400, 0.85)
        out.append(f'<text x="{cx}" y="{start + i * 21}" text-anchor="middle" dominant-baseline="central" '
                   f'font-size="{size}" font-weight="{weight}" fill="{p["node_text"]}" opacity="{op}">{esc(ln)}</text>')
    return "".join(out)


def cyl(x, y, w, h, label, p):
    ry = 12
    body = (f'<path d="M{x},{y+ry} a{w/2},{ry} 0 0 1 {w},0 v{h-2*ry} a{w/2},{ry} 0 0 1 {-w},0 z" '
            f'fill="{p["db"]}" stroke="{p["db_s"]}" stroke-width="1.5"/>'
            f'<path d="M{x},{y+ry} a{w/2},{ry} 0 0 0 {w},0" fill="none" stroke="{p["db_s"]}" stroke-width="1.5" opacity="0.8"/>')
    txt = (f'<text x="{x+w/2}" y="{y+h/2+4}" text-anchor="middle" font-size="14.5" font-weight="600" '
           f'fill="{p["node_text"]}">{esc(label)}</text>')
    return body + txt


def diamond(cx, cy, w, h, lines, p):
    pts = f"{cx},{cy-h/2} {cx+w/2},{cy} {cx},{cy+h/2} {cx-w/2},{cy}"
    out = [f'<polygon points="{pts}" fill="{p["gate"]}" stroke="{p["gate_s"]}" stroke-width="1.5"/>']
    start = cy - (len(lines) - 1) * 9
    for i, ln in enumerate(lines):
        out.append(f'<text x="{cx}" y="{start + i*18}" text-anchor="middle" dominant-baseline="central" '
                   f'font-size="13.5" font-weight="600" fill="#e2e8f0">{esc(ln)}</text>')
    return "".join(out)


def edge(d, p, dashed=False, width=2):
    color = p["edge_async"] if dashed else p["edge"]
    dash = ' stroke-dasharray="6 5"' if dashed else ""
    marker = "b" if dashed else "a"
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"{dash} marker-end="url(#{marker})"/>'


def label(x, y, text, p, anchor="middle", mono=False):
    w = len(text) * (6.6 if mono else 6.9) + 12
    fam = f' font-family="{MONO}"' if mono else ""
    dx = {"middle": -w / 2, "start": -6, "end": -w + 6}[anchor]
    return (f'<rect x="{x+dx}" y="{y-10}" width="{w}" height="19" rx="4" fill="{p["canvas"]}"/>'
            f'<text x="{x}" y="{y}" text-anchor="{anchor}" dominant-baseline="central" font-size="12.5"{fam} '
            f'fill="{p["label"]}">{esc(text)}</text>')


def title(x, y, text, sub, p):
    return (f'<text x="{x}" y="{y}" font-size="11" font-weight="600" letter-spacing="1.4" fill="{p["muted"]}">{esc(text)}</text>'
            f'<text x="{x}" y="{y+26}" font-size="19" font-weight="600" fill="{p["title"]}">{esc(sub)}</text>')


def band(x, y, w, h, text, p):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="none" stroke="{p["frame"]}" '
            f'stroke-width="1.2" stroke-dasharray="3 4"/>'
            f'<text x="{x+14}" y="{y+18}" font-size="10.5" font-weight="600" letter-spacing="1.3" fill="{p["muted"]}">{esc(text)}</text>')


# ---------------------------------------------------------------- system map
def system_map(p):
    W, H = 940, 620
    s = [head(W, H, p), title(40, 44, "WEBHOOK INSPECTOR", "System map", p)]

    s.append(band(28, 92, 884, 400, "", p))
    s.append(node(60, 130, 180, 76, ["Webhook provider", "Stripe, Alchemy, CI"], p["ext"], p["ext_s"], p))
    s.append(node(380, 130, 200, 76, ["API", "Fastify"], p["svc"], p["svc_s"], p))
    s.append(node(720, 130, 170, 76, ["Browser", "dashboard"], p["ext"], p["ext_s"], p))
    s.append(cyl(390, 270, 180, 96, "PostgreSQL", p))
    s.append(cyl(70, 282, 160, 76, "Redis", p))
    s.append(node(380, 410, 200, 70, ["Delivery worker"], p["svc"], p["svc_s"], p))
    s.append(node(720, 410, 170, 70, ["Forward target"], p["ext"], p["ext_s"], p))

    s.append(edge("M240,168 H372", p, width=2.6))
    s.append(label(306, 158, "1  POST /i/:slug", p, mono=True))

    s.append(edge("M500,206 V264", p, width=2.6))
    s.append(label(556, 236, "2  insert", p))
    s.append(edge("M440,264 V212", p, dashed=True))
    s.append(label(388, 236, "3  NOTIFY", p, anchor="end"))

    s.append(edge("M580,160 H712", p, width=2.6))
    s.append(label(646, 148, "4  SSE stream", p))
    s.append(edge("M712,190 H588", p))
    s.append(label(650, 202, "REST reads", p))

    s.append(edge("M500,366 V404", p, dashed=True))
    s.append(label(560, 388, "5  claim work", p))
    s.append(edge("M440,404 V372", p))
    s.append(label(384, 388, "7  record attempt", p, anchor="end"))

    s.append(edge("M580,445 H712", p, width=2.6))
    s.append(label(646, 433, "6  deliver", p))

    s.append(edge("M380,196 H300 Q286,196 286,210 V300 Q286,314 272,314 H238", p))
    s.append(label(300, 262, "rate limit", p))

    y = 536
    key = [("Outside", p["ext"], p["ext_s"]), ("Service", p["svc"], p["svc_s"]), ("State", p["db"], p["db_s"])]
    x = 40
    for name, fill, stroke in key:
        s.append(f'<rect x="{x}" y="{y-9}" width="16" height="16" rx="4" fill="{fill}" stroke="{stroke}"/>')
        s.append(f'<text x="{x+24}" y="{y}" dominant-baseline="central" font-size="12.5" fill="{p["muted"]}">{name}</text>')
        x += 118
    s.append(f'<line x1="{x}" y1="{y}" x2="{x+26}" y2="{y}" stroke="{p["edge"]}" stroke-width="2.6"/>')
    s.append(f'<text x="{x+34}" y="{y}" dominant-baseline="central" font-size="12.5" fill="{p["muted"]}">request path</text>')
    x += 158
    s.append(f'<line x1="{x}" y1="{y}" x2="{x+26}" y2="{y}" stroke="{p["edge_async"]}" stroke-width="2" stroke-dasharray="6 5"/>')
    s.append(f'<text x="{x+34}" y="{y}" dominant-baseline="central" font-size="12.5" fill="{p["muted"]}">background work</text>')

    s.append(f'<text x="40" y="588" font-size="12.5" fill="{p["muted"]}">Steps 1 to 4 complete without waiting on step 6, so a dead forward target never slows capture down.</text>')
    s.append("</svg>")
    return "".join(s)


# ------------------------------------------------------------- lifecycle
def lifecycle(p):
    W, H = 1000, 1020
    s = [head(W, H, p), title(40, 44, "WEBHOOK INSPECTOR", "What happens to one request", p)]

    col, cw, cx = 120, 270, 255
    rx, rw = 580, 260

    s.append(node(col, 100, cw, 60, ["Request arrives"], p["svc"], p["svc_s"], p))
    s.append(diamond(cx, 240, 260, 88, ["Slug known", "and active?"], p))
    s.append(diamond(cx, 390, 260, 88, ["Rate limit", "token free?"], p))
    s.append(diamond(cx, 540, 260, 88, ["Body within", "1 MB?"], p))
    s.append(node(col, 640, cw, 70, ["Store raw bytes", "headers, query, source IP"], p["svc"], p["svc_s"], p))
    s.append(diamond(cx, 820, 260, 88, ["Forward URL", "set?"], p))
    s.append(node(col, 920, cw, 66, ["Queued for delivery", "5 attempts, backoff, dedupe"], p["svc"], p["svc_s"], p))

    s.append(node(rx, 214, rw, 52, ["404   nothing stored"], p["bad"], p["bad_s"], p, sub_from=9))
    s.append(node(rx, 364, rw, 52, ["429   rate limited"], p["bad"], p["bad_s"], p, sub_from=9))
    s.append(node(rx, 514, rw, 52, ["413   stored as truncated"], p["bad"], p["bad_s"], p, sub_from=9))
    s.append(node(rx, 649, rw, 52, ["Pushed to live tail"], p["ok"], p["ok_s"], p, sub_from=9))
    s.append(node(rx, 794, rw, 52, ["Ends here, visible in UI"], p["ok"], p["ok_s"], p, sub_from=9))

    for cy in (240, 390, 540):
        s.append(edge(f"M{cx+130},{cy} H{rx-8}", p))
        s.append(label((cx + 130 + rx) / 2, cy - 13, "no", p))

    s.append(edge("M255,160 V196", p, width=2.6))
    for y0, y1 in ((284, 346), (434, 496), (584, 636)):
        s.append(edge(f"M255,{y0} V{y1}", p, width=2.6))
        s.append(label(272, (y0 + y1) / 2, "yes", p, anchor="start"))

    s.append(edge("M390,675 H572", p))
    s.append(edge("M255,710 V776", p, width=2.6))
    s.append(edge("M385,820 H572", p))
    s.append(label(482, 807, "no", p))
    s.append(edge("M255,864 V916", p, width=2.6))
    s.append(label(272, 890, "yes", p, anchor="start"))

    s.append(f'<text x="40" y="{H-22}" font-size="12.5" fill="{p["muted"]}">Every rejection is answered before anything is stored. An oversized body is the exception: it is recorded as truncated.</text>')
    s.append("</svg>")
    return "".join(s)


for name, fn in (("system-map", system_map), ("lifecycle", lifecycle)):
    for theme, pal in (("light", LIGHT), ("dark", DARK)):
        path = f"{OUT}/{name}-{theme}.svg"
        open(path, "w").write(fn(pal))
        print(path)
