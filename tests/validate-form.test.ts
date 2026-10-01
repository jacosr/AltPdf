const { validate } = require('../agent-pack/validate-form.js') as {
    validate: (html: string) => { errors: string[]; warnings: string[] };
};

describe('agent-pack/validate-form.js', () => {
    test('passes a clean, well-formed form with no issues', () => {
        const html = `
            <form name="contact">
                <input type="text" name="name">
                <fieldset name="prefs">
                    <input type="checkbox" name="flavors" value="a">
                    <input type="checkbox" name="flavors" value="b">
                    <input type="radio" name="size" value="s">
                    <input type="radio" name="size" value="l">
                </fieldset>
                <img src="logo.png">
                <link rel="stylesheet" href="apdf://localhost/index.css">
            </form>
        `;
        const { errors, warnings } = validate(html);
        expect(errors).toEqual([]);
        expect(warnings).toEqual([]);
    });

    test('flags an input with no name attribute', () => {
        const html = `<form name="f"><input type="text" id="no-name-here"></form>`;
        const { errors } = validate(html);
        expect(errors).toEqual([expect.stringContaining('Missing "name" attribute')]);
    });

    test('flags a form with no <form> element at all', () => {
        const html = `<div><input type="text" name="x"></div>`;
        const { errors } = validate(html);
        expect(errors).toEqual([expect.stringContaining('No <form> element found')]);
    });

    test('flags mixing checkbox and radio under the same name', () => {
        const html = `
            <form name="f">
                <input type="checkbox" name="pref" value="a">
                <input type="radio" name="pref" value="b">
            </form>
        `;
        const { errors } = validate(html);
        expect(errors).toEqual([expect.stringContaining('used on both checkbox and radio')]);
    });

    test('flags a fieldset name colliding with a sibling field name in the same scope', () => {
        const html = `
            <form name="f">
                <fieldset name="contact"><input type="text" name="email"></fieldset>
                <input type="text" name="contact">
            </form>
        `;
        const { errors } = validate(html);
        expect(errors).toEqual([expect.stringContaining('used as both a fieldset name and a field name')]);
    });

    test('does not flag a field name reused across two different fieldsets (no real collision)', () => {
        const html = `
            <form name="f">
                <fieldset name="contact"><input type="text" name="email"></fieldset>
                <fieldset name="billing"><input type="text" name="email"></fieldset>
            </form>
        `;
        const { errors, warnings } = validate(html);
        expect(errors).toEqual([]);
        expect(warnings).toEqual([]);
    });

    test('warns when two non-checkbox/radio fields share a name in the same scope', () => {
        const html = `
            <form name="f">
                <input type="text" name="twice">
                <input type="text" name="twice">
            </form>
        `;
        const { warnings } = validate(html);
        expect(warnings).toEqual([expect.stringContaining('reused by 2 non-checkbox/radio fields')]);
    });

    test('warns on an external URL and errors on an absolute local path', () => {
        const html = `
            <form name="f">
                <link rel="stylesheet" href="https://cdn.example.com/style.css">
                <img src="C:\\Users\\me\\pic.png">
            </form>
        `;
        const { errors, warnings } = validate(html);
        expect(errors).toEqual([expect.stringContaining('Absolute path')]);
        expect(warnings).toEqual([expect.stringContaining('External resource reference')]);
    });

    test('does not flag a single checkbox or a single radio option', () => {
        const html = `
            <form name="f">
                <input type="checkbox" name="agree" value="yes">
                <input type="radio" name="only_choice" value="x">
            </form>
        `;
        const { errors, warnings } = validate(html);
        expect(errors).toEqual([]);
        expect(warnings).toEqual([]);
    });

    test('ignores submit/button/reset/image inputs entirely, even without a name', () => {
        const html = `
            <form name="f">
                <input type="text" name="ok">
                <input type="submit" value="Go">
                <input type="button" value="Cancel">
            </form>
        `;
        const { errors, warnings } = validate(html);
        expect(errors).toEqual([]);
        expect(warnings).toEqual([]);
    });
});
