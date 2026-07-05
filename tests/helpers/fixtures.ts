import * as fs from 'fs';
import * as path from 'path';

// Loads a fixture from tests/testdata by filename, e.g. loadFixture('full.json').
export function loadFixture(name: string): any {
    const filePath = path.join(__dirname, '..', 'testdata', name);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}
