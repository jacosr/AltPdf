/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'jsdom',
    testMatch: ['<rootDir>/tests/**/*.test.ts'],
    setupFiles: ['<rootDir>/tests/jest.setup.ts'],
    modulePathIgnorePatterns: ['<rootDir>/.claude'],
    moduleNameMapper: {
        '^electron$': '<rootDir>/tests/mocks/electron.ts',
    },
    transform: {
        '^.+\\.ts$': 'ts-jest',
    },
};
