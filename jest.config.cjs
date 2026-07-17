module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '\\.(css|less|scss)$': 'identity-obj-proxy',
  },
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
  transform: {
    '^.+\\.(t|j)sx?$': 'babel-jest',
  },
  // Force every source file into the coverage report, not just ones a test
  // happens to import — otherwise a wholly-untested new file would never
  // pull the thresholds below down. types/ and data/ are pure
  // interfaces/seed data with no executable logic to cover.
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/main.tsx',
    '!src/types/**',
    '!src/data/**',
  ],
  coverageThreshold: {
    global: {
      statements: 88,
      branches: 80,
      functions: 100,
      lines: 90,
    },
  },
}
