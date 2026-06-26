module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        diagnostics: {
          ignoreCodes: [151002],
        },
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',

  // Coverage thresholds to enforce code quality standards
  // Builds will fail if coverage metrics fall below these targets
  // These are set to be achievable with current codebase while still enforcing improvement
  coverageThreshold: {
    global: {
      // Minimum percentage of statements that must be covered
      statements: 45,
      // Minimum percentage of branches (if/else, ternary, etc.) that must be covered
      branches: 35,
      // Minimum percentage of functions that must be covered
      functions: 45,
      // Minimum percentage of lines that must be covered
      lines: 45,
    },
    // Directory-specific thresholds for stricter enforcement on core modules
    './src/auth/': {
      statements: 55,
      branches: 35,
      functions: 55,
      lines: 55,
    },
    './src/database/': {
      statements: 8,
      branches: 8,
      functions: 8,
      lines: 8,
    },
  },

  // Coverage reporters to generate reports in multiple formats
  coverageReporters: ['text', 'text-summary', 'html', 'lcov', 'json-summary'],

  // Skip coverage collection for certain files
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '.interface.ts$',
    '.dto.ts$',
    '.entity.ts$',
    '.module.ts$',
  ],
};
