/**
 * Renders docs/PARTNER_API.md into a self-contained HTML reference at
 * server/docs-static/partner-api-reference.html, served at GET /api/v1/docs.
 *
 * The Markdown stays the single source of truth - run `npm run docs:build`
 * after editing it. Deliberately NOT wired into `npm run build`: the generated
 * file is committed, so the Docker image just copies docs-static/ as it already
 * does, and a rendering bug can never break the production image build.
 *
 * The renderer only covers the constructs PARTNER_API.md actually uses -
 * headings, fenced code (json/bash/js/python/php), tables, rules, lists, and
 * blockquotes. There is no nesting to handle. If you add a construct to the
 * Markdown, add it here too rather than assuming it renders.
 *
 * One deliberate escape hatch: a ```diagram fence is emitted verbatim, not
 * escaped or highlighted - the only way to get raw HTML (the onboarding
 * illustrations) into an otherwise-plain-Markdown source of truth without
 * inventing a second templating layer. Content inside must be hand-verified
 * safe (it's fixed docs source, not user input) and self-contained: it can
 * reference the page's own CSS custom properties (var(--rust) etc.) since
 * it's inlined into the same document, but must bring its own component
 * classes if the standard stylesheet below doesn't already define them.
 */
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../../docs/PARTNER_API.md");
const OUT = path.resolve(__dirname, "../docs-static/partner-api-reference.html");

// ── Inline formatting ────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// GitHub-style heading slug, so the doc's own [text](#anchor) links resolve.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

// Runs on already-escaped text. Code spans are extracted first and reinserted
// last so their contents never pick up bold/link formatting.
//
// The placeholder is delimited by NUL, not spaces: a " 12 " sentinel would also
// match ordinary numbers in prose ("up to 100 orders"), replacing them with an
// out-of-range lookup and emitting "undefined". NUL cannot occur in the source.
function inline(raw: string): string {
  const spans: string[] = [];
  let s = escapeHtml(raw).replace(/`([^`]+)`/g, (_m, code) => {
    spans.push(`<code>${code}</code>`);
    return `\u0000${spans.length - 1}\u0000`;
  });

  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
    const external = /^https?:/.test(href);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${href}"${attrs}>${text}</a>`;
  });
  // Single-asterisk emphasis, but not the bare "*" used as a footnote marker.
  s = s.replace(/(?<!\*)\*([^*\s][^*]*)\*(?!\*)/g, "<em>$1</em>");

  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => spans[Number(i)]);
}

// ── Code highlighting ────────────────────────────────────────────────────────

// One pass over the escaped source with a single alternation, replaced via a
// callback - so a match is never re-scanned and we can't corrupt an emitted tag.
const PATTERNS: Record<string, RegExp> = {
  json: /("(?:[^"\\]|\\.)*")(\s*:)?|(\b-?\d+\.?\d*\b)|(\btrue\b|\bfalse\b|\bnull\b)/g,
  bash: /(#[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\$\w+|\$\{[^}]*\})|(\b(?:curl|echo|export|if|then|fi|for|do|done)\b)/g,
  js: /(\/\/[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b(?:const|let|var|async|await|function|return|if|else|for|of|new|throw|try|catch)\b)|(\b-?\d+\.?\d*\b)/g,
  python: /(#[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\b(?:import|from|def|return|if|else|elif|for|in|with|as|raise|try|except|True|False|None)\b)|(\b-?\d+\.?\d*\b)/g,
  php: /(\/\/[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\$\w+)|(\b(?:function|return|if|else|foreach|as|new|echo|true|false|null)\b)/g,
};

function highlight(code: string, lang: string): string {
  const escaped = escapeHtml(code);
  const re = PATTERNS[lang];
  if (!re) return escaped;

  return escaped.replace(re, (match, g1, g2, g3, g4) => {
    if (lang === "json") {
      // g1 is a string; a following colon (g2) makes it a key.
      if (g1) return g2 ? `<span class="t-key">${g1}</span>${g2}` : `<span class="t-str">${g1}</span>`;
      if (g3) return `<span class="t-num">${g3}</span>`;
      if (g4) return `<span class="t-lit">${g4}</span>`;
      return match;
    }
    if (g1) return `<span class="t-com">${g1}</span>`;
    if (g2) return `<span class="t-str">${g2}</span>`;
    if (g3) return `<span class="t-var">${g3}</span>`;
    if (g4) return `<span class="t-kw">${g4}</span>`;
    return match;
  });
}

// ── Block parsing ────────────────────────────────────────────────────────────

interface Heading {
  level: number;
  text: string;
  slug: string;
}

function render(md: string): { html: string; headings: Heading[] } {
  const lines = md.split("\n");
  const out: string[] = [];
  const headings: Heading[] = [];
  const seenSlugs = new Set<string>();
  let i = 0;

  const closeList = (stack: string[]) => {
    while (stack.length) out.push(`</${stack.pop()}>`);
  };
  const listStack: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      closeList(listStack);
      const lang = fence[1] || "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++; // closing fence

      if (lang === "diagram") {
        // Raw HTML passthrough - see the file-header comment. Not a code
        // sample, so no copy button/lang badge/highlighting.
        out.push(body.join("\n"));
        continue;
      }

      const label = lang ? `<span class="code-lang">${lang}</span>` : "";
      out.push(
        `<div class="code-block">${label}` +
          `<button class="copy-btn" type="button" aria-label="Copy code">Copy</button>` +
          `<pre><code>${highlight(body.join("\n"), lang)}</code></pre></div>`,
      );
      continue;
    }

    // Table: a run of pipe-leading lines, second of which is the separator.
    if (line.trim().startsWith("|") && lines[i + 1]?.trim().match(/^\|[\s:|-]+\|$/)) {
      closeList(listStack);
      const cells = (row: string) =>
        row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));

      const thead = head.map((c) => `<th>${inline(c)}</th>`).join("");
      const tbody = rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("");
      out.push(
        `<div class="table-wrap"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`,
      );
      continue;
    }

    // Heading, with an optional trailing {.class-name} - the one bit of
    // Pandoc-style attribute syntax this renderer supports, since headings
    // are emitted flat (siblings, not nested under their h2), so a rule like
    // "#some-section h3 {...}" can never match a real h3 - it's not a
    // descendant of anything. A class is the only way to scope styling to a
    // specific heading without a bigger restructure into <section> wrappers.
    const h = line.match(/^(#{1,6})\s+(.*?)(?:\s*\{\.([\w-]+)\})?$/);
    if (h) {
      closeList(listStack);
      const level = h[1].length;
      const text = h[2].trim();
      const className = h[3];
      let slug = slugify(text);
      // Duplicate headings (several "#### Example") would collide otherwise.
      let n = 1;
      while (seenSlugs.has(slug)) slug = `${slugify(text)}-${n++}`;
      seenSlugs.add(slug);
      if (level <= 3) headings.push({ level, text, slug });
      const classAttr = className ? ` class="${className}"` : "";
      out.push(
        `<h${level} id="${slug}"${classAttr}>${inline(text)}` +
          `<a class="anchor" href="#${slug}" aria-label="Link to this section">#</a></h${level}>`,
      );
      i++;
      continue;
    }

    if (line.trim() === "---") {
      closeList(listStack);
      out.push("<hr>");
      i++;
      continue;
    }

    // Blockquote: a run of "> " lines becomes one callout box. No nested
    // blockquotes/lists inside - PARTNER_API.md only uses these for
    // single-paragraph asides.
    if (line.startsWith(">")) {
      closeList(listStack);
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        body.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<div class="callout">${inline(body.join(" "))}</div>`);
      continue;
    }

    const ol = line.match(/^(\d+)\.\s+(.*)$/);
    if (ol) {
      if (listStack[listStack.length - 1] !== "ol") {
        closeList(listStack);
        out.push("<ol>");
        listStack.push("ol");
      }
      out.push(`<li>${inline(ol[2])}</li>`);
      i++;
      continue;
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (listStack[listStack.length - 1] !== "ul") {
        closeList(listStack);
        out.push("<ul>");
        listStack.push("ul");
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      i++;
      continue;
    }

    if (line.trim() === "") {
      closeList(listStack);
      i++;
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !lines[i].match(/^#{1,6}\s/) &&
      lines[i].trim() !== "---" &&
      !lines[i].trim().startsWith("|") &&
      !lines[i].match(/^(\d+)\.\s/) &&
      !lines[i].match(/^\s*[-*]\s/) &&
      !lines[i].startsWith(">")
    ) {
      para.push(lines[i++]);
    }
    if (para.length) {
      closeList(listStack);
      out.push(`<p>${inline(para.join(" "))}</p>`);
    } else {
      i++;
    }
  }

  closeList(listStack);
  return { html: out.join("\n"), headings };
}

// ── Page template ────────────────────────────────────────────────────────────

function buildToc(headings: Heading[]): string {
  return headings
    .filter((h) => h.level === 2 || h.level === 3)
    .map(
      (h) =>
        `<a class="toc-link toc-h${h.level}" href="#${h.slug}" data-slug="${h.slug}">${escapeHtml(
          h.text,
        )}</a>`,
    )
    .join("\n");
}

function page(content: string, toc: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ParcelMoover Partner API — Developer Reference</title>
<meta name="description" content="Integration reference for the ParcelMoover Partner API v1: orders, tracking, rates, COD settlements, and webhooks.">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

:root{
  --rust:#c2410c; --rust-soft:#ffedd5;
  --ink:#030712; --muted:#4b5563; --faint:#6b7280;
  --border:#d1d5db; --canvas:#f3f4f6; --surface:#ffffff; --elevated:#e5e7eb;
  --success:#15803d; --danger:#b91c1c; --info:#1d4ed8;
  --code-bg:#f8f9fa;
  --t-key:#1d4ed8; --t-str:#15803d; --t-num:#a16207; --t-lit:#7c3aed;
  --t-com:#6b7280; --t-kw:#c2410c; --t-var:#b91c1c;
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --sidebar:280px;
}

/* Devs read API docs at 2am. Tokens flip; every rule below is theme-agnostic. */
@media (prefers-color-scheme:dark){
  :root{
    --ink:#f3f4f6; --muted:#9ca3af; --faint:#6b7280;
    --border:#374151; --canvas:#0b0f19; --surface:#111827; --elevated:#1f2937;
    --rust:#fb923c; --rust-soft:#7c2d12;
    --success:#4ade80; --danger:#f87171; --info:#60a5fa;
    --code-bg:#0b0f19;
    --t-key:#60a5fa; --t-str:#4ade80; --t-num:#fbbf24; --t-lit:#c4b5fd;
    --t-com:#6b7280; --t-kw:#fb923c; --t-var:#f87171;
  }
}

html{scroll-behavior:smooth}
body{
  font-family:var(--sans); font-size:14px; font-weight:500; line-height:1.65;
  color:var(--ink); background:var(--canvas);
  -webkit-font-smoothing:antialiased;
}

.layout{display:grid; grid-template-columns:var(--sidebar) minmax(0,1fr); align-items:start}

/* Sidebar */
.sidebar{
  position:sticky; top:0; height:100vh; overflow-y:auto;
  background:var(--surface); border-right:1px solid var(--border); padding:24px 0;
}
.brand{padding:0 20px 18px; border-bottom:1px solid var(--border); margin-bottom:16px}
.brand-name{font-size:16px; font-weight:700; letter-spacing:-.01em}
.brand-sub{font-size:12px; font-weight:500; color:var(--faint); margin-top:2px}
.brand-badge{
  display:inline-block; margin-top:10px; padding:2px 8px; border-radius:9999px;
  background:var(--rust-soft); color:var(--rust); font-size:11px; font-weight:700;
  letter-spacing:.04em; text-transform:uppercase;
}
.console-link{
  display:inline-block; margin-top:12px; font-size:12.5px; font-weight:600;
  color:var(--rust); text-decoration:none;
}
.console-link:hover{text-decoration:underline}
.toc-link{
  display:block; padding:5px 20px; color:var(--muted); text-decoration:none;
  font-size:13px; border-left:2px solid transparent;
}
.toc-link:hover{color:var(--ink); background:var(--canvas)}
.toc-link.toc-h3{padding-left:34px; font-size:12.5px; color:var(--faint)}
.toc-link.active{color:var(--rust); border-left-color:var(--rust); background:var(--rust-soft)}
@media (prefers-color-scheme:dark){ .toc-link.active{background:transparent} }

/* Content */
main{padding:48px 56px 120px; max-width:920px}

h1,h2,h3,h4,h5,h6{line-height:1.25; letter-spacing:-.02em; scroll-margin-top:24px}
h1{font-size:40px; font-weight:700; margin-bottom:8px}
h2{font-size:28px; font-weight:700; margin:56px 0 16px; padding-top:24px; border-top:1px solid var(--border)}
h3{font-size:21px; font-weight:650; margin:36px 0 12px}
h4{font-size:16px; font-weight:650; margin:26px 0 10px; color:var(--muted)}
h1+p{font-size:16px; color:var(--muted); font-weight:500}

.anchor{
  margin-left:8px; color:var(--border); text-decoration:none; font-weight:500;
  opacity:0; transition:opacity .12s;
}
h1:hover .anchor,h2:hover .anchor,h3:hover .anchor,h4:hover .anchor{opacity:1}
.anchor:hover{color:var(--rust)}

p{margin:12px 0}
a{color:var(--rust); text-decoration:underline; text-underline-offset:2px}
strong{font-weight:680}
/* hr is always hidden - h2 already carries its own border-top as the visual
   divider, so a "---" right before every "## Heading" (the doc's own
   convention) would otherwise double it up. There used to be a second rule
   here (h2 plus-selector hr, and hr plus-selector h2), meant to reinforce
   that - but the second half of that pair doesn't mean "an hr followed by
   h2", it means "an h2 that follows an hr", and matched (hid, with zero
   layout box) almost every h2 in the document, permanently. That's what
   broke every top-level TOC link (nothing to scroll to) and the scrollspy
   (getBoundingClientRect() on a display:none element is always all-zero, so
   it looked "active" no matter the real scroll position). The base rule
   below already covers the original concern on its own - nothing else is
   needed. */
hr{border:0; border-top:1px solid var(--border); margin:32px 0; display:none}

ul,ol{margin:12px 0 12px 22px}
li{margin:6px 0}

/* Inline code — distinct from surrounding prose without shouting. */
code{
  font-family:var(--mono); font-size:12.5px; font-weight:500;
  background:var(--elevated); padding:1.5px 5px; border-radius:3px;
  word-break:break-word;
}

/* Code blocks: 1px border, no shadow — same-plane surface. */
.code-block{position:relative; margin:16px 0}
.code-block pre{
  background:var(--code-bg); border:1px solid var(--border); border-radius:6px;
  padding:16px 18px; overflow-x:auto;
}
.code-block pre code{background:none; padding:0; font-size:12.5px; line-height:1.6}
.code-lang{
  position:absolute; top:0; right:0; padding:3px 10px;
  font-family:var(--mono); font-size:10.5px; font-weight:600;
  color:var(--faint); text-transform:uppercase; letter-spacing:.06em;
  border-left:1px solid var(--border); border-bottom:1px solid var(--border);
  border-radius:0 6px 0 6px; background:var(--surface);
}
.copy-btn{
  position:absolute; top:8px; right:64px; padding:3px 10px;
  font-family:var(--sans); font-size:11px; font-weight:600; color:var(--muted);
  background:var(--surface); border:1px solid var(--border); border-radius:4px;
  cursor:pointer; opacity:0; transition:opacity .12s;
}
.code-block:hover .copy-btn{opacity:1}
.copy-btn:hover{color:var(--rust); border-color:var(--rust)}
.copy-btn.copied{color:var(--success); border-color:var(--success); opacity:1}

.t-key{color:var(--t-key)} .t-str{color:var(--t-str)} .t-num{color:var(--t-num)}
.t-lit{color:var(--t-lit)} .t-com{color:var(--t-com);font-style:italic}
.t-kw{color:var(--t-kw)} .t-var{color:var(--t-var)}

/* Tables — 1px separation, never a shadow. */
.table-wrap{overflow-x:auto; margin:16px 0; border:1px solid var(--border); border-radius:6px}
table{border-collapse:collapse; width:100%; font-size:13px}
th,td{padding:9px 14px; text-align:left; vertical-align:top; border-bottom:1px solid var(--border)}
th{
  background:var(--elevated); font-weight:650; font-size:11.5px;
  text-transform:uppercase; letter-spacing:.05em; color:var(--muted); white-space:nowrap;
}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--canvas)}
td:first-child{white-space:nowrap; font-family:var(--mono); font-size:12px}
td code{background:none; padding:0}

/* Note/callout boxes (> blockquotes). Plain 1px border, same-plane surface
   rule as every other box on this page - no accent border. */
.callout{
  margin:16px 0; padding:12px 16px; border:1px solid var(--border); border-radius:6px;
  background:var(--elevated); font-size:13.5px; color:var(--muted);
}
.callout code{background:var(--surface)}

/* Quick Start step numbering - a CSS counter driven by document order (works
   without real DOM nesting, unlike a descendant selector - headings render
   as flat siblings, see the heading-parsing comment above). The Markdown
   source just tags the relevant h3s "{.qs-step}"; this numbers them 1..n in
   the order they appear, wherever body{counter-reset} sits relative to them. */
body{counter-reset:qs-step}
h3.qs-step{counter-increment:qs-step; display:flex; align-items:center; gap:12px}
h3.qs-step::before{
  content:counter(qs-step); flex:none; width:28px; height:28px; border-radius:50%;
  background:var(--rust); color:#fff; font-size:14px; font-weight:700;
  display:flex; align-items:center; justify-content:center;
}

/* ── UI mockups (the "diagram" fence passthrough) ──────────────────────────
   Fake browser chrome + a simplified dashboard, built from div/CSS rather
   than screenshots: never goes stale when the real UI's pixels shift, no
   image assets to ship, and it inherits light/dark mode for free via the
   page's own custom properties. Not meant to be pixel-accurate - just
   enough shape (sidebar, tabs, a button, a reveal-once secret) that a
   first-time reader recognizes the real dashboard when they get there. */
.ui-mock{
  margin:20px 0 28px; border:1px solid var(--border); border-radius:8px;
  overflow:hidden; background:var(--surface);
}
.ui-mock-bar{
  display:flex; align-items:center; gap:6px; padding:9px 12px;
  background:var(--elevated); border-bottom:1px solid var(--border);
}
.ui-mock-dot{width:9px; height:9px; border-radius:50%; background:var(--border)}
.ui-mock-url{
  margin-left:8px; padding:3px 10px; border-radius:5px; background:var(--surface);
  border:1px solid var(--border); font-family:var(--mono); font-size:11px; color:var(--faint);
}
.ui-mock-body{display:flex; min-height:180px}
.ui-mock-nav{
  width:150px; flex:none; padding:14px 0; border-right:1px solid var(--border);
  background:var(--canvas); font-size:12px;
}
.ui-mock-nav-item{padding:7px 16px; color:var(--muted)}
.ui-mock-nav-item.active{
  color:var(--rust); font-weight:650; background:var(--rust-soft);
  border-right:2px solid var(--rust);
}
.ui-mock-nav-sub{padding:6px 16px 6px 28px; color:var(--faint); font-size:11.5px}
.ui-mock-nav-sub.active{color:var(--rust); font-weight:650}
.ui-mock-content{flex:1; padding:18px 20px}
.ui-mock-heading{font-size:14px; font-weight:700; margin-bottom:12px}
.ui-mock-btn{
  display:inline-flex; align-items:center; gap:6px; padding:6px 14px;
  background:var(--rust); color:#fff; font-size:12px; font-weight:650;
  border-radius:5px;
}
.ui-mock-field{
  display:flex; flex-direction:column; gap:3px; margin-bottom:10px; max-width:320px;
}
.ui-mock-field label{font-size:11px; color:var(--faint); font-weight:650}
.ui-mock-field .ui-mock-input{
  padding:6px 10px; border:1px solid var(--border); border-radius:5px;
  background:var(--canvas); font-size:12px; color:var(--muted);
}
.ui-mock-secret{
  margin-top:12px; padding:10px 12px; border:1px dashed var(--rust); border-radius:6px;
  background:var(--rust-soft); display:flex; align-items:center; justify-content:space-between; gap:10px;
}
.ui-mock-secret code{background:none; color:var(--ink); font-size:12.5px}
.ui-mock-chip{
  flex:none; padding:2px 8px; border-radius:9999px; background:var(--rust); color:#fff;
  font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.04em;
}
@media (max-width:560px){ .ui-mock-nav{display:none} }

@media (max-width:900px){
  .layout{grid-template-columns:1fr}
  /* A 30+ entry TOC dumped inline, un-bounded, above the content pushes a
     first-time reader through a full screen of links before they reach any
     actual doc - bound it to a scrollable strip instead, same as it already
     behaves as a sticky panel on desktop. */
  .sidebar{
    position:static; height:auto; max-height:220px; overflow-y:auto;
    border-right:0; border-bottom:1px solid var(--border);
  }
  main{padding:32px 20px 80px}
  h1{font-size:30px} h2{font-size:23px} h3{font-size:18px}
}
</style>
</head>
<body>
<div class="layout">
  <nav class="sidebar">
    <div class="brand">
      <div class="brand-name">ParcelMoover</div>
      <div class="brand-sub">Partner API Reference</div>
      <span class="brand-badge">v1</span>
      <a class="console-link" href="/api/v1/docs/console">Open try-it console &rarr;</a>
    </div>
${toc}
  </nav>
  <main>
${content}
  </main>
</div>
<script>
// Copy buttons
document.querySelectorAll('.copy-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    var code = btn.parentElement.querySelector('code');
    navigator.clipboard.writeText(code.innerText).then(function(){
      btn.textContent = 'Copied'; btn.classList.add('copied');
      setTimeout(function(){ btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1400);
    });
  });
});

// Scrollspy: highlight the TOC entry for the section currently in view.
var links = {};
document.querySelectorAll('.toc-link').forEach(function(a){ links[a.dataset.slug] = a; });
var targets = Object.keys(links).map(function(s){ return document.getElementById(s); }).filter(Boolean);
var current = null;
function sync(){
  // Default to the first section, not null: before you've scrolled past
  // Quick Start's heading (true for the entire top of the page, since it
  // sits below the intro paragraph and base-URL table), every target's top
  // is > 100 and nothing satisfied the loop below - so nothing was ever
  // marked active until you scrolled past the first heading.
  var best = targets[0] || null;
  for (var i = 0; i < targets.length; i++) {
    if (targets[i].getBoundingClientRect().top <= 100) best = targets[i];
  }
  if (best && best.id !== current) {
    if (current && links[current]) links[current].classList.remove('active');
    links[best.id].classList.add('active');
    current = best.id;
  }
}
sync();
window.addEventListener('scroll', function(){ window.requestAnimationFrame(sync); }, { passive: true });
</script>
</body>
</html>
`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const md = fs.readFileSync(SRC, "utf8");
const { html, headings } = render(md);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, page(html, buildToc(headings)), "utf8");

console.log(
  `Wrote ${path.relative(process.cwd(), OUT)} ` +
    `(${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, ${headings.length} nav entries)`,
);
