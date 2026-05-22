#!/usr/bin/env python3
"""
Regenerate website-agreement-print.html from WEBSITE-AGREEMENT.md.

Run from the repo root:
    python3 scripts/build-website-agreement-print.py

Requires the `markdown` Python package (`pip install markdown`).

Both the source and the generated output are git-ignored — the
agreement is a private document between Corey and the owners. The
script itself is safe to commit (no content is embedded here; it just
formats the markdown).

When to run: produce a clean printable when it's time to sign, or
after editing the source. Open the resulting HTML in any browser,
press Ctrl + P, and either print or "Save as PDF."
"""

import os
import sys

try:
    import markdown
except ImportError:
    sys.stderr.write("Missing dependency: pip install markdown\n")
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'WEBSITE-AGREEMENT.md')
DST = os.path.join(ROOT, 'website-agreement-print.html')

if not os.path.exists(SRC):
    sys.stderr.write(
        f"Source not found: {SRC}\n"
        "This script expects a private WEBSITE-AGREEMENT.md at the\n"
        "repo root (git-ignored). Create or restore it before running.\n"
    )
    sys.exit(1)

with open(SRC, encoding='utf-8') as f:
    md_source = f.read()

body_html = markdown.markdown(
    md_source,
    extensions=['tables', 'fenced_code', 'attr_list'],
    output_format='html5'
)

TEMPLATE = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Play2Win Games — Handoff & Portfolio Understanding</title>
  <style>
    /* Print-optimized stylesheet for the private Corey/Owners agreement.
       Serif typography for document feel, generous whitespace, signature
       lines preserved as plain text. */

    :root {
      --text: #1a1a1a;
      --muted: #555;
      --rule: #c8c8c8;
      --accent: #1a4ca6;
    }

    * { box-sizing: border-box; }
    html { font-size: 16px; }

    body {
      font-family: Georgia, "Times New Roman", "Liberation Serif", serif;
      font-size: 12pt;
      line-height: 1.6;
      color: var(--text);
      background: #fafafa;
      max-width: 6.8in;
      margin: 0 auto;
      padding: 0.7in 0.5in 0.9in;
    }

    .print-banner {
      background: #fff8d6;
      border: 1px solid #e6cf6a;
      border-radius: 4px;
      padding: 12px 16px;
      margin-bottom: 32px;
      font-size: 0.9em;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    }
    .print-banner strong { color: #d91f38; }

    /* The agreement opens with a privacy notice in bold — let it read as
       a stamp. */
    body > p:first-of-type strong {
      display: block;
      text-align: center;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #b22a2a;
      font-size: 0.85em;
      margin-bottom: 8pt;
    }

    h1, h2 {
      font-family: Georgia, "Times New Roman", serif;
      color: #000;
      page-break-after: avoid;
    }
    h1 {
      font-size: 20pt;
      text-align: center;
      margin: 0 0 8pt;
      padding-bottom: 8pt;
      border-bottom: 1px solid var(--rule);
      line-height: 1.3;
    }
    h2 {
      font-size: 14pt;
      margin: 22pt 0 6pt;
    }

    p, ul, ol { margin: 0 0 9pt; }
    li { margin-bottom: 4pt; }

    strong { color: #000; }
    em { color: var(--muted); }

    hr {
      border: 0;
      border-top: 1px solid var(--rule);
      margin: 20pt 0;
    }

    /* Signature blocks at the end — preserve the underscore lines but
       give them a little breathing room. */
    h2#signatures ~ p {
      margin: 12pt 0;
      font-family: "Courier New", Consolas, monospace;
      font-size: 11pt;
      white-space: pre-wrap;
    }
    h2#signatures ~ p strong {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 12pt;
    }

    @page { margin: 0.7in; }

    @media print {
      body {
        background: #fff;
        max-width: none;
        margin: 0;
        padding: 0;
        font-size: 11.5pt;
      }
      .print-banner { display: none; }

      /* Force the signatures section onto its own page so signatures
         never get orphaned mid-page from the terms. */
      h2#signatures { page-break-before: page; }

      h1, h2 { page-break-after: avoid; }
      p, ul, ol { page-break-inside: avoid; }

      a { color: var(--text); text-decoration: none; }

      @page {
        @bottom-right {
          content: "Page " counter(page) " of " counter(pages);
          font-size: 9pt;
          color: #888;
          font-family: Georgia, serif;
        }
        @bottom-left {
          content: "Play2Win Games — Handoff & Portfolio";
          font-size: 9pt;
          color: #888;
          font-family: Georgia, serif;
        }
      }
    }
  </style>
</head>
<body>
  <div class="print-banner">
    <strong>Printable version.</strong> To print or save as PDF: press
    <strong>Ctrl + P</strong> (or <strong>&#8984; P</strong> on Mac),
    choose your printer or &ldquo;Save as PDF.&rdquo; Generated from
    <code>WEBSITE-AGREEMENT.md</code> &mdash; both source and this
    output are <strong>git-ignored / private</strong> and must not be
    committed.
  </div>
{BODY}
</body>
</html>
'''

with open(DST, 'w', encoding='utf-8', newline='') as f:
    f.write(TEMPLATE.replace('{BODY}', body_html))

print(f'Wrote {DST} ({os.path.getsize(DST)} bytes)')
print('Remember: this output is git-ignored. Print it, sign it, do not commit it.')
