module.exports = {
  "transform": {
    "^.+\\.ts?$": "ts-jest"
  },
  'globals': {
    'ts-jest': {
      'diagnostics': {
        'warnOnly': true
      }
    }
  },
  "testRegex": "(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$",
  "moduleFileExtensions": [
    "ts",
    "tsx",
    "js",
    "jsx",
    "node"
  ],
  "testPathIgnorePatterns": ['mocks.ts'],
  "moduleNameMapper": {
    '^html-whitespace-sensitive-tag-names$':
    '<rootDir>/test-mocks/html-whitespace-sensitive-tag-names.json'
  },
  "collectCoverage": false,
  "testEnvironment": "node",
  "collectCoverageFrom": [
    "packages/**/src/**/*",
    "!packages/teleport-test/**/*",
    "!packages/teleport-types/**/*"
  ]
}
