import '../src/preload';
import { loadTestForm } from './helpers/dom';
import { loadFixture } from './helpers/fixtures';

const altpdf = (window as any).altpdf;

function field<T extends Element>(selector: string): T {
    return document.querySelector(selector) as T;
}

describe('_bindData (exercised via window.altpdf.bindData)', () => {
    beforeEach(() => {
        loadTestForm();
    });

    test('binds a full data set into nested fieldsets, checkboxes, radios and multi-selects', () => {
        const data = loadFixture('full.json');
        altpdf.bindData(data);

        expect(field<HTMLInputElement>('[name=name]').value).toBe('Ada Lovelace');
        expect(field<HTMLInputElement>('[name=email]').value).toBe('ada@example.com');
        expect(field<HTMLInputElement>('[name=age]').value).toBe('34');

        expect(field<HTMLInputElement>('[name=carbonation][value=high]').checked).toBe(true);
        expect(field<HTMLInputElement>('[name=carbonation][value=medium]').checked).toBe(false);

        expect(field<HTMLInputElement>('[name=flavors][value=citrus]').checked).toBe(true);
        expect(field<HTMLInputElement>('[name=flavors][value=malty]').checked).toBe(true);
        expect(field<HTMLInputElement>('[name=flavors][value=smoky]').checked).toBe(true);
        expect(field<HTMLInputElement>('[name=flavors][value=sour]').checked).toBe(false);

        const settingsSelect = field<HTMLSelectElement>('[name=preferred_settings]');
        const selected = Array.from(settingsSelect.selectedOptions).map(o => o.value);
        expect(selected).toEqual(['home', 'outdoors', 'concert']);

        expect(field<HTMLInputElement>('[name=drink_with][value=friends]').checked).toBe(true);
        expect(field<HTMLInputElement>('[name=group_size]').value).toBe('6');

        expect(field<HTMLInputElement>('[name=clarity][value=hazy]').checked).toBe(true);
        expect(field<HTMLInputElement>('[name=head_size][value=generous]').checked).toBe(true);

        expect(field<HTMLTextAreaElement>('[name=notes]').value).toBe('Loves saisons.');
    });

    test('normalizes scalar checkbox and select-multiple values into single selections', () => {
        const data = loadFixture('scalar-multivalue.json');
        altpdf.bindData(data);

        expect(field<HTMLInputElement>('[name=flavors][value=chocolate]').checked).toBe(true);
        expect(field<HTMLInputElement>('[name=flavors][value=citrus]').checked).toBe(false);

        const settingsSelect = field<HTMLSelectElement>('[name=preferred_settings]');
        const selected = Array.from(settingsSelect.selectedOptions).map(o => o.value);
        expect(selected).toEqual(['restaurant']);
    });

    test('leaves fields untouched when their key is absent from the data', () => {
        const data = loadFixture('partial.json');
        altpdf.bindData(data);

        expect(field<HTMLInputElement>('[name=name]').value).toBe('Partial Test');
        expect(field<HTMLInputElement>('[name=occasion][value=special]').checked).toBe(true);

        // fields with no corresponding key keep whatever the HTML already had
        expect(field<HTMLInputElement>('[name=email]').value).toBe('');
        expect(field<HTMLInputElement>('[name=preferred_time]').value).toBe('18:00');
        expect(field<HTMLInputElement>('[name=carbonation][value=medium]').checked).toBe(true);
    });

    test('does nothing when the data has no top-level form key', () => {
        const data = loadFixture('empty.json');

        expect(() => altpdf.bindData(data)).not.toThrow();

        expect(field<HTMLInputElement>('[name=name]').value).toBe('');
        expect(field<HTMLInputElement>('[name=carbonation][value=medium]').checked).toBe(true);
    });

    test('falls back to the only form on the page when the data key matches no form name or id', () => {
        const data = loadFixture('unknown-form-name.json');
        altpdf.bindData(data);

        expect(field<HTMLInputElement>('[name=name]').value).toBe('Fallback Test');
        expect(field<HTMLInputElement>('[name=bitterness]').value).toBe('10');
        expect(field<HTMLInputElement>('[name=flavors][value=sour]').checked).toBe(true);
    });

    test('does not throw and leaves nested fields untouched when a fieldset value is not a plain object', () => {
        const data = loadFixture('fieldset-type-mismatch.json');

        expect(() => altpdf.bindData(data)).not.toThrow();

        expect(field<HTMLInputElement>('[name=name]').value).toBe('Type Mismatch');
        // 'advanced' held an array instead of an object, so its nested fields keep their HTML defaults
        expect(field<HTMLInputElement>('[name=abv_preference]').value).toBe('5');
        expect(field<HTMLInputElement>('[name=preferred_region]').value).toBe('');
        expect(field('[name=clarity]:checked')).toBeNull();
    });
});
