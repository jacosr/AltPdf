import '../src/preload';
import { loadTestForm } from './helpers/dom';
import { loadFixture } from './helpers/fixtures';

const altpdf = (window as any).altpdf;

describe('_getFormData (exercised via window.altpdf.getFormData)', () => {
    beforeEach(() => {
        loadTestForm();
    });

    test('round-trips a fully populated form back into the same shape as full.json', () => {
        const data = loadFixture('full.json');
        altpdf.bindData(data);

        expect(altpdf.getFormData()).toEqual(data);
    });

    test('round-trips scalar checkbox/select-multiple values back into the same shape as scalar-multivalue.json', () => {
        const data = loadFixture('scalar-multivalue.json');
        altpdf.bindData(data);

        expect(altpdf.getFormData()).toEqual(data);
    });

    test('collects data under the form\'s own name even when it was bound via a fallback form lookup', () => {
        const data = loadFixture('unknown-form-name.json');
        altpdf.bindData(data);

        const result = altpdf.getFormData();
        expect(Object.keys(result)).toEqual(['beer_survey']);
        expect(result.beer_survey).toEqual(data.not_a_real_form);
    });

    test('collects the pristine default values of the untouched testform', () => {
        const result = altpdf.getFormData();

        expect(result.beer_survey.personal).toEqual({ name: '', email: '', age: '', phone: '' });
        expect(result.beer_survey.taste_profile).toMatchObject({
            bitterness: '30',
            sweetness: '5',
            body: '3',
            carbonation: 'medium',
            preferred_color: '#dba020',
        });
    });
});
