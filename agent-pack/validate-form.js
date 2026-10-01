#!/usr/bin/env node
'use strict';

// Zero-dependency structural linter for AltPDF forms. Checks an index.html
// against the data-binding contract described in ALTPDF_FORM_GUIDE.md, without
// needing a real DOM parser or any npm install — this has to run with nothing
// but Node itself, since it gets dropped into arbitrary destination folders.
//
// Usage: node validate-form.js <folder-or-index.html>
// Exit code: 0 if no errors (warnings still allowed), 1 if any error, 2 on
// usage/IO problems.

const fs = require('fs');
const path = require('path');

const SKIP_COLLECT_TYPES = new Set(['submit', 'button', 'reset', 'image']);

function stripNonMarkup(html) {
  // Drop comments, and blank the *contents* of <script>/<style> blocks (keeping
  // the tags themselves) so stray '<' or quotes inside JS/CSS can't be mistaken
  // for markup by the tokenizer below.
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, (_, open, close) => open + close);
  html = html.replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi, (_, open, close) => open + close);
  return html;
}

function parseAttributes(attrString) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|[^\s"'=<>`]+))?/g;
  let m;
  while ((m = re.exec(attrString))) {
    const name = m[1].toLowerCase();
    const value = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : (m[2] !== undefined ? m[2] : '');
    attrs[name] = value;
  }
  return attrs;
}

// Flattens the document into a sequence of { tag, attrs, closing } tokens in
// document order. Good enough for structural checks on roughly well-formed
// HTML — it is not a real parser, so badly mismatched tags can throw off
// fieldset-nesting tracking; that's an accepted limitation for a linter this
// small.
function tokenize(html) {
  const tokens = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const raw = m[0];
    const closing = raw.startsWith('</');
    const tag = m[1].toLowerCase();
    const attrString = (m[2] || '').replace(/\/\s*$/, '');
    tokens.push({ tag, attrs: closing ? {} : parseAttributes(attrString), closing });
  }
  return tokens;
}

function classify(tag, attrs) {
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return null;
  const type = (attrs.type || (tag === 'input' ? 'text' : tag)).toLowerCase();
  if (tag === 'input' && SKIP_COLLECT_TYPES.has(type)) return null;
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  return 'other';
}

function validate(html) {
  const errors = [];
  const warnings = [];
  const cleaned = stripNonMarkup(html);
  const tokens = tokenize(cleaned);

  let formCount = 0;
  const fieldsetStack = []; // names of enclosing named fieldsets, innermost last
  // scopeKey ("a>b" of enclosing fieldset names, "" for top level) -> name -> { kinds: Set, count }
  const scopeUsage = new Map();

  function currentScopeKey() {
    return fieldsetStack.join('>');
  }

  function registerUsage(name, kind) {
    const scopeKey = currentScopeKey();
    if (!scopeUsage.has(scopeKey)) scopeUsage.set(scopeKey, new Map());
    const usage = scopeUsage.get(scopeKey);
    if (!usage.has(name)) usage.set(name, { kinds: new Set(), count: 0 });
    const entry = usage.get(name);
    entry.kinds.add(kind);
    entry.count += 1;
  }

  for (const t of tokens) {
    if (t.tag === 'form') {
      if (!t.closing) formCount++;
      continue;
    }

    if (t.tag === 'fieldset') {
      if (!t.closing) {
        // Register in the PARENT scope (before pushing) — a fieldset's name is
        // a key on its enclosing object, not on the scope it creates.
        if (t.attrs.name) registerUsage(t.attrs.name, 'fieldset');
        fieldsetStack.push(t.attrs.name || null);
      } else {
        fieldsetStack.pop();
      }
      continue;
    }

    if (t.closing) continue;

    const kind = classify(t.tag, t.attrs);
    if (kind === null) continue;

    const name = t.attrs.name;
    if (!name) {
      const typeNote = t.attrs.type ? ` type="${t.attrs.type}"` : '';
      errors.push(`Missing "name" attribute on <${t.tag}${typeNote}> — its value will never be saved.`);
      continue;
    }
    registerUsage(name, kind);
  }

  if (formCount === 0) {
    errors.push('No <form> element found — AltPDF only collects data from within a <form>.');
  } else if (formCount > 1) {
    warnings.push(`Found ${formCount} <form> elements — only one will be used; keep to a single form per page.`);
  }

  for (const [scopeKey, usage] of scopeUsage) {
    for (const [name, entry] of usage) {
      const scopeLabel = scopeKey ? `fieldset "${scopeKey.split('>').pop()}"` : 'the top level';

      if (entry.kinds.has('fieldset') && entry.kinds.size > 1) {
        errors.push(`"${name}" is used as both a fieldset name and a field name within ${scopeLabel} — this collides in the saved data.`);
        continue;
      }
      if (entry.kinds.has('checkbox') && entry.kinds.has('radio')) {
        errors.push(`"${name}" is used on both checkbox and radio inputs within ${scopeLabel} — pick one; mixing breaks the saved value's shape.`);
        continue;
      }
      if (entry.kinds.has('other') && entry.count > 1) {
        warnings.push(`"${name}" is reused by ${entry.count} non-checkbox/radio fields within ${scopeLabel} — their values will silently collapse into an array. Give each a unique name, or make them a checkbox group.`);
      }
    }
  }

  const assetRe = /<(?:img|script|link|source|audio|video)\b[^>]*\b(?:src|href)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let am;
  while ((am = assetRe.exec(cleaned))) {
    const value = am[2] !== undefined ? am[2] : am[3];
    if (!value) continue;
    if (/^(https?:)?\/\//i.test(value)) {
      warnings.push(`External resource reference "${value}" — .apdf files are meant to work fully offline; bundle this file locally instead.`);
    } else if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('file://') || value.startsWith('/')) {
      errors.push(`Absolute path "${value}" — use a relative path (or "apdf://localhost/...") so it still resolves once packaged.`);
    }
  }

  return { errors, warnings };
}

function resolveIndexHtml(target) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    const indexPath = path.join(target, 'index.html');
    if (!fs.existsSync(indexPath)) {
      console.error(`No index.html found in ${target}`);
      process.exit(2);
    }
    return indexPath;
  }
  return target;
}

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node validate-form.js <folder-or-index.html>');
    process.exit(2);
  }
  if (!fs.existsSync(target)) {
    console.error(`Not found: ${target}`);
    process.exit(2);
  }

  const htmlPath = resolveIndexHtml(target);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const { errors, warnings } = validate(html);

  console.log(`Validating ${htmlPath}`);
  if (!errors.length && !warnings.length) {
    console.log('✓ No issues found.');
    process.exit(0);
  }
  for (const e of errors) console.log(`✗ ERROR   ${e}`);
  for (const w of warnings) console.log(`! WARNING ${w}`);
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(errors.length ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { validate };
