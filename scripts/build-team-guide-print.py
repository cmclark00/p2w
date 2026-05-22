#!/usr/bin/env python3
"""
Regenerate team-guide-print.html from TEAM-GUIDE.md.

Run from the repo root:
    python3 scripts/build-team-guide-print.py

Requires the `markdown` Python package (`pip install markdown`).

When to run: any time TEAM-GUIDE.md is substantively edited and you want
the printable handout version refreshed. The output file is committed,
so the latest printable is always available without needing this
script — but it goes stale until regenerated.
"""

import os
import sys

try:
    import markdown
except ImportError:
    sys.stderr.write("Missing dependency: pip install markdown\n")
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'TEAM-GUIDE.md')
DST = os.path.join(ROOT, 'team-guide-print.html')

with open(SRC, encoding='utf-8') as f:
    md_source = f.read()

body_html = markdown.markdown(
    md_source,
    extensions=['tables', 'fenced_code', 'attr_list', 'toc'],
    output_format='html5'
)

TEMPLATE = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Play2Win Games — Team Edit Guide (Printable)</title>
  <style>
    /* Print-optimized stylesheet. Designed for paper handouts during
       onboarding sessions; also reads cleanly on screen if a team
       member prefers viewing in a browser. */

    :root {
      --text: #1a1a1a;
      --muted: #555;
      --border: #c8c8c8;
      --code-bg: #f3f3f3;
      --accent: #d91f38;
      --rule: #ddd;
    }

    * { box-sizing: border-box; }
    html { font-size: 16px; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.55;
      color: var(--text);
      background: #fafafa;
      max-width: 7.5in;
      margin: 0 auto;
      padding: 0.6in 0.5in 0.8in;
    }

    .print-banner {
      background: #fff8d6;
      border: 1px solid #e6cf6a;
      border-radius: 4px;
      padding: 12px 16px;
      margin-bottom: 28px;
      font-size: 0.95em;
    }
    .print-banner strong { color: var(--accent); }

    h1, h2, h3, h4 {
      font-family: "Helvetica Neue", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      line-height: 1.2;
      color: #000;
      page-break-after: avoid;
    }
    h1 { font-size: 22pt; margin: 0 0 8pt; border-bottom: 2px solid var(--accent); padding-bottom: 6pt; }
    h2 { font-size: 15pt; margin: 24pt 0 8pt; border-bottom: 1px solid var(--rule); padding-bottom: 4pt; }
    h3 { font-size: 12.5pt; margin: 16pt 0 6pt; }
    h4 { font-size: 11pt; margin: 12pt 0 4pt; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }

    p, ul, ol { margin: 0 0 8pt; }
    li { margin-bottom: 3pt; }
    li > p { margin-bottom: 4pt; }
    ul ul, ol ol, ul ol, ol ul { margin: 4pt 0; }

    a { color: #1a4ca6; text-decoration: none; border-bottom: 1px dotted #1a4ca6; }

    code { font-family: "SF Mono", Consolas, "Liberation Mono", Menlo, monospace; font-size: 0.9em; background: var(--code-bg); padding: 1px 4px; border-radius: 3px; }
    pre {
      background: var(--code-bg);
      border: 1px solid var(--rule);
      border-radius: 4px;
      padding: 10pt 12pt;
      font-family: "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 9.5pt;
      line-height: 1.4;
      overflow-x: auto;
      page-break-inside: avoid;
      margin: 8pt 0 14pt;
    }
    pre code { background: transparent; padding: 0; font-size: inherit; }

    blockquote { border-left: 3px solid var(--accent); margin: 8pt 0 14pt; padding: 4pt 12pt; color: var(--muted); page-break-inside: avoid; }

    table { border-collapse: collapse; width: 100%; margin: 8pt 0 16pt; font-size: 0.95em; page-break-inside: avoid; }
    th, td { border: 1px solid var(--border); padding: 6pt 8pt; text-align: left; vertical-align: top; }
    th { background: #efefef; font-weight: 600; }

    hr { border: 0; border-top: 1px solid var(--rule); margin: 18pt 0; }
    strong { color: #000; }

    h2#table-of-contents + ul { columns: 2; column-gap: 24pt; }

    @page { margin: 0.6in; }

    @media print {
      body { background: #fff; max-width: none; margin: 0; padding: 0; font-size: 10.5pt; }
      .print-banner { display: none; }
      h2 { page-break-before: auto; }
      h2#common-tasks,
      h2#when-something-is-wrong,
      h2#external-services,
      h2#using-claude-when-this-guide-isnt-enough,
      h2#emergency-contact { page-break-before: page; }
      h2, h3, h4 { page-break-after: avoid; }
      pre, table, blockquote, ul, ol { page-break-inside: avoid; }
      a { color: var(--text); border-bottom: none; }
      a[href^="http"]::after {
        content: " (" attr(href) ")";
        font-size: 0.78em;
        color: var(--muted);
        word-break: break-all;
      }
      a[href^="#"]::after { content: ""; }
      @page {
        @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 9pt; color: #888; }
        @bottom-left  { content: "Play2Win Games — Team Edit Guide"; font-size: 9pt; color: #888; }
      }
    }
  </style>
</head>
<body>
  <div class="print-banner">
    <strong>Printable version.</strong> To print or save as PDF: press
    <strong>Ctrl + P</strong> (or <strong>&#8984; P</strong> on Mac),
    choose your printer or &ldquo;Save as PDF.&rdquo; This file is
    generated from <code>TEAM-GUIDE.md</code> &mdash; regenerate via
    <code>python3 scripts/build-team-guide-print.py</code> after
    meaningful edits.
  </div>
{BODY}
</body>
</html>
'''

with open(DST, 'w', encoding='utf-8', newline='') as f:
    f.write(TEMPLATE.replace('{BODY}', body_html))

print(f'Wrote {DST} ({os.path.getsize(DST)} bytes)')
