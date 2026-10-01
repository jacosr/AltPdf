import '../src/preload';

const altpdf = (window as any).altpdf;

describe('highlightStyle (exercised via window.altpdf.getHighlightStyle/setHighlightStyle)', () => {
    test('defaults to "background-color: yellow"', () => {
        expect(altpdf.getHighlightStyle()).toBe('background-color: yellow');
    });

    test('reflects an override after setHighlightStyle', () => {
        altpdf.setHighlightStyle('outline: 2px solid red');
        expect(altpdf.getHighlightStyle()).toBe('outline: 2px solid red');

        // restore the default so this test doesn't leak state into others
        altpdf.setHighlightStyle('background-color: yellow');
    });
});
