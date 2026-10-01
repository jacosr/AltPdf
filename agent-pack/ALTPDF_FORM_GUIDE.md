# Building forms for AltPDF

This is the reference guide for building a form that works correctly with AltPDF's
default data collection and data binding. Read this whole document before writing
or editing any form. It is written so an AI agent can follow it end-to-end for
someone who has never written HTML before — if the person you're helping can
describe what they want in plain English, you can do everything else: write the
HTML and CSS, structure the data correctly, check it, and explain what happens next.

## 1. What AltPDF is

An AltPDF file (`.apdf`) is a small, self-contained website — an `index.html` page
plus whatever CSS/JS/images it needs — zipped up and renamed from `.zip` to `.apdf`.
Opening it in the AltPDF app loads that `index.html` the same way a browser would.

Two things follow from this:

- **Everything must be local and relative.** Reference other files in the same
  package with a plain relative path (`href="index.css"`, `src="logo.png"`), or
  with the `apdf://localhost/...` prefix (`href="apdf://localhost/index.css"`) —
  both work and mean the same thing. Never use an absolute path
  (`C:\...`, `file://...`, `/Users/...`) or a `http(s)://` URL to an external
  site — the whole point of a `.apdf` file is that it works offline, portably,
  with nothing fetched from the internet. If a form needs a font or icon set,
  bundle the actual files in the package rather than linking to a CDN.
- **There is no server and no build step.** Plain HTML, CSS, and (only if truly
  needed) vanilla JS. No bundlers, no frameworks that require a build, no
  `fetch()` calls to anything outside the package.

## 2. The data-binding contract

If you follow this contract, AltPDF's *default* data collection and data binding
just work — nobody has to write any JavaScript. This is the part that's easy to
get subtly wrong, so follow it precisely.

**The rule in one sentence:** the shape of your saved data mirrors the shape of
your `<form>` — the form's `name` is the top-level key, each input's `name`
becomes a property, and a `<fieldset name="...">` nests a sub-object.

### Every field needs a `name` (not just an `id`)

`id` is for CSS/labels. `name` is what gets saved. An input with no `name` is
silently skipped — its value never gets saved or restored.

```html
<label for="email">Email</label>
<input type="email" name="email" id="email">
```

### The form itself should have a `name`

```html
<form name="signup">
  ...
</form>
```

Given a name `"signup"` and a field `name="email"` with value `"a@b.com"`,
the saved data looks like:

```json
{ "signup": { "email": "a@b.com" } }
```

(If the form has no `name`, AltPDF falls back to using its `id`, or just "form" —
always give it a real name.)

### Group related fields with a named `<fieldset>`

A `<fieldset name="...">` nests everything inside it under that key. This is the
*only* way to get nested objects — plain `<div>`s are just layout and don't affect
the saved shape at all.

```html
<form name="signup">
  <fieldset name="contact">
    <input type="text" name="name">
    <input type="email" name="email">
  </fieldset>
</form>
```

produces:

```json
{ "signup": { "contact": { "name": "...", "email": "..." } } }
```

A `<fieldset>` with **no** `name` is purely visual grouping (e.g. for a `<legend>`
and some CSS) — its fields get flattened into the parent, not nested. That's fine
and often what you want for lightweight visual sections; just don't expect it to
produce a nested object.

Fieldsets can nest inside each other for deeper structure.

### Checkboxes and same-named repeated fields become arrays

Give every checkbox in a group the **same** `name` and a distinct `value`. Every
checked box ends up in an array under that one key:

```html
<fieldset name="preferences">
  <input type="checkbox" name="flavors" value="vanilla"> Vanilla
  <input type="checkbox" name="flavors" value="chocolate"> Chocolate
  <input type="checkbox" name="flavors" value="coffee"> Coffee
</fieldset>
```

If the user checks Vanilla and Coffee:

```json
{ "flavors": ["vanilla", "coffee"] }
```

If exactly **one** box in a same-named group ends up checked, the value collapses
to a plain string instead of a one-item array — that's expected, not a bug; don't
special-case it.

An unchecked checkbox contributes nothing — if *no* box in a group is checked, the
key doesn't appear in the saved data at all. Downstream code (including AltPDF's
own "view changes" feature) treats a missing key as "nothing selected," so don't
rely on the key always being present.

### Radio buttons

Same rule as checkboxes — same `name`, distinct `value` per option — but radios
are mutually exclusive by nature, so the saved value is always a single string,
never an array:

```html
<input type="radio" name="size" value="small"> Small
<input type="radio" name="size" value="large"> Large
```

**Never mix `type="checkbox"` and `type="radio"` under the same `name`.** They
have incompatible selection semantics and the saved value becomes ambiguous.

### `<select multiple>`

Behaves like a checkbox group — the array is every selected `<option>`'s `value`.
A single-select `<select>` (no `multiple`) saves the one selected value as a
string, same as a text input.

### Every other input type

`text`, `email`, `tel`, `number`, `date`, `range`, `color`, `textarea`, and a
single-select `<select>` all just save their `value` as a string under their
`name`, at whatever level of nesting their enclosing fieldset puts them.

`submit`, `button`, `reset`, and `image` inputs are never collected — they're
controls, not data.

## 3. How to build a form from a plain-language description

Follow this sequence. Don't skip the validation step at the end.

1. **Clarify if needed.** If the request is ambiguous (unclear whether something
   is single-choice vs. multi-choice, which fields are required, how things should
   be grouped), ask — but don't over-ask; make a reasonable call on small stuff and
   say what you assumed.
2. **Plan the fields.** List every field, its type (text, checkbox group, radio
   group, select, etc.), and which logical group (fieldset) it belongs to. Give
   the form itself a clear, lowercase, no-spaces `name` (e.g. `contact_form`,
   `event_signup`) and give each fieldset a similarly clean `name`.
3. **Write `index.html`.** Use semantic HTML with real `<label>`s tied to each
   input via matching `for`/`id`. Reference your stylesheet as
   `<link rel="stylesheet" href="index.css">` (or the `apdf://localhost/` form —
   both work). Look at the two examples in `examples/` in this kit for the actual
   markup patterns (`examples/simple/` for a flat form, `examples/nested-fieldsets/`
   for grouped fields with checkboxes, radios, and a multi-select).
4. **Write `index.css`.** Keep it in a separate file, referenced the same way.
   Favor clear, readable, reasonably attractive default styling — the person you're
   helping likely has no CSS to give you, so the whole visual result is on you.
5. **Add a Save button, wired with a small `index.js`.** This is the one common,
   expected use of JavaScript in an AltPDF form — without it, saving only works
   via the app's File → Save menu (or Ctrl+S), which isn't discoverable for most
   people filling out a form. Use a plain `<button type="button">`, **never**
   `type="submit"` (a real submit tries to navigate the page, which does nothing
   useful here and can wipe unsaved input):

   ```html
   <button type="button" id="save">Save</button>
   ```
   ```js
   document.getElementById('save').addEventListener('click', async () => {
     await window.altpdf.saveFile();
   });
   ```

   Beyond that, only write more JavaScript if the defaults genuinely aren't enough
   (e.g. dynamic show/hide logic, live validation feedback, a computed field).
   AltPDF's default data collection and binding require zero JS beyond the Save
   button — don't add anything else "just in case." Never manually `fetch(...)` a
   data file or hand-roll your own save format (see the note on `data-temp.json`
   below) — that bypasses AltPDF's default binding entirely.
6. **Validate.** Run:
   ```
   node validate-form.js <path-to-the-form-folder-or-file>
   ```
   (the script lives at the root of this kit). Fix everything it reports before
   telling the person the form is done. If it can't find Node on this machine,
   say so and walk through the checklist in this guide by hand instead.
7. **Explain packaging**, since this kit doesn't automate it: put `index.html`,
   `index.css`, and any other assets in one folder, compress that folder's
   *contents* (not the folder itself) into a `.zip`, then rename the `.zip` to
   `.apdf`. On Windows, select the files → right-click → "Compress to ZIP file" (or
   `Compress-Archive -Path .\* -DestinationPath .\form.zip` in PowerShell) → rename
   `.zip` to `.apdf`. On macOS, select the files → right-click → "Compress" → rename.
   Opening the resulting `.apdf` in AltPDF should show the finished form.

## 4. Common mistakes to avoid

- **A `<button type="submit">` or `<input type="submit">`.** This triggers a real
  HTML form submission with nowhere to go — use `type="button"` wired to
  `window.altpdf.saveFile()` instead (see section 3, step 5).
- **Using `id` where you meant `name`.** Only `name` is saved; `id` is just a CSS/
  label hook. A field with an `id` but no `name` silently loses its data.
- **Mixing checkbox and radio under one `name`.** Pick one semantic per name.
- **Reusing a `name` across unrelated fields**, or across two different fieldsets,
  or both inside and outside a fieldset — this produces ambiguous or overwritten
  data. Every field name should be unique within whatever it's nested inside.
- **Absolute or external paths** for CSS, images, fonts, or scripts — breaks
  offline portability, and images/styles may simply fail to load in the AltPDF
  viewer.
- **Manually loading or saving a custom data file.** AltPDF automatically loads
  `data-temp.json` (the working draft) and reflects it back into the form the
  default way — don't override this unless there's a real need the default truly
  can't handle, and if you do, keep the same JSON shape described in section 2 so
  AltPDF's signing and "view changes" features keep working.
- **An unnamed `<form>`.** Works, but falls back to a generic key — always name it.

## 5. Examples in this kit

- `examples/simple/index.html` — a flat form, no fieldsets, just top-level fields.
  Good starting point for something like a short signup or contact form.
- `examples/nested-fieldsets/index.html` — grouped fields via named fieldsets,
  a checkbox group, a radio group, and a multi-select, showing exactly how each
  produces its corresponding JSON shape.

Read both before generating a new form — matching their patterns is the fastest
way to stay compliant.
