/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  // *.module.ts files are pure @Module DI wiring with no branching logic to
  // unit-test — their correctness is exercised by the app actually booting
  // (integration tests), not a unit test. Migration files are already
  // exercised for real against live Postgres by the server-migrations-drift
  // CI job, a stronger check than a mocked unit test would give.
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.test.ts',
    '!main.ts',
    '!**/*.module.ts',
    '!database/migrations/**',
  ],
  coverageThreshold: {
    global: {
      statements: 88,
      branches: 82,
      functions: 100,
      lines: 88,
    },
  },
  clearMocks: true,
}
