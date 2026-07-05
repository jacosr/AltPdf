import * as fs from 'fs';
import * as path from 'path';

const FORM_HTML_PATH = path.join(__dirname, '..', 'testform', 'index.html');
const formHtml = fs.readFileSync(FORM_HTML_PATH, 'utf-8').match(/<form[\s\S]*?<\/form>/)?.[0];

if (!formHtml) {
    throw new Error(`Could not find a <form> in ${FORM_HTML_PATH}`);
}

// Resets document.body to the pristine testform markup so each test starts
// from the same known set of default field values.
export function loadTestForm(): void {
    document.body.innerHTML = formHtml as string;
}
