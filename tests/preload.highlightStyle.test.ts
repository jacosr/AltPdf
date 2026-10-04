import '../src/preload';

const altpdf = (window as any).altpdf;

describe('highlightStyle (exercised via window.altpdf.getHighlightStyle/setHighlightStyle)', () => {
    const DEFAULT_STYLE = 'background-color: yellow; border: 1px solid yellow; color: black; outline: 2px solid yellow;';

    test('defaults to a non-empty style that includes outline, since that is what highlights checkboxes/radios', () => {
        expect(altpdf.getHighlightStyle()).toBe(DEFAULT_STYLE);
        expect(altpdf.getHighlightStyle()).toContain('outline');
    });

    test('reflects an override after setHighlightStyle', () => {
        altpdf.setHighlightStyle('outline: 2px solid red');
        expect(altpdf.getHighlightStyle()).toBe('outline: 2px solid red');

        // restore the default so this test doesn't leak state into others
        altpdf.setHighlightStyle(DEFAULT_STYLE);
    });
});
