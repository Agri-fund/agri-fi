module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000,
  roots: ['<rootDir>/tests/e2e'],
  testMatch: ['**/*.test.ts'],
  preset: 'ts-jest',
  moduleFileExtensions: ['ts', 'js', 'json'],
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
    },
  },
  coverageDirectory: '../coverage/e2e',
};
