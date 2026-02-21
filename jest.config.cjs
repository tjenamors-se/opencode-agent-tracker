module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['\u003crootDir\u003e/src', '\u003crootDir\u003e/tests'],
  testMatch: ['**/tests/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/types.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  reporters: ['default'],
  moduleNameMapper: {'^(.+)\\.js$': '$1'},
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true
    }
  }
};