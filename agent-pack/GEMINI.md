# AltPDF form project

This project is a form meant to be packaged as an AltPDF (`.apdf`) file — a small
zipped website AltPDF opens like a PDF. Before writing or editing any form markup,
read `ALTPDF_FORM_GUIDE.md` at the project root — it has the full data-binding
contract and the workflow to follow. Look at `examples/simple/` and
`examples/nested-fieldsets/` for concrete markup patterns.

Key rules (the guide has the full detail):
- The person you're helping may not know HTML at all — write everything, ask only
  what's genuinely ambiguous.
- Every field needs `name` (not just `id`); `<fieldset name="...">` nests an
  object; same-`name` checkboxes become an array; never mix checkbox and radio
  under one `name`; only relative local paths, no external URLs.
- Add a `<button type="button">` wired to `window.altpdf.saveFile()` — never
  `type="submit"`.

Before calling a form finished, run `node validate-form.js <path-to-the-form-folder>`
(the script is at the project root) and fix everything it reports.
