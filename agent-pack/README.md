# AltPDF AI Form-Building Kit

This folder helps an AI coding assistant build or fix a form for AltPDF — you
don't need to read the details yourself, just open this folder with one of the
tools below and describe the form you want.

## How to use it

1. Copy this whole folder to wherever you want to build your form (or use it
   in place — it works either way).
2. Open that folder in **one** of these tools:
   - **Claude Code** — just start it in this folder; it picks up
     `.claude/skills/altpdf-form-builder/` automatically.
   - **Cursor** — open this folder; it picks up `.cursor/rules/altpdf-forms.mdc`
     automatically.
   - **GitHub Copilot** (VS Code or the Copilot CLI) — open this folder; it
     reads `.github/copilot-instructions.md` automatically.
   - **Gemini CLI** — run it in this folder; it reads `GEMINI.md` automatically.
3. Describe the form you want in plain English. The assistant will write
   `index.html` (and CSS, and a save button) for you, check its own work, and
   tell you what to do next to turn it into a `.apdf` file.

Already have a form and just want it checked? Ask the assistant to validate it,
or run this yourself if you have Node installed:

```
node validate-form.js <path-to-your-form-folder>
```

## What's in here

- `ALTPDF_FORM_GUIDE.md` — the actual knowledge document; every adapter below
  just points here.
- `validate-form.js` — the checker script, works standalone with plain Node,
  no install required.
- `examples/` — two working reference forms.
- `.claude/`, `.cursor/`, `.github/`, `GEMINI.md` — the per-tool adapter files
  described above.
