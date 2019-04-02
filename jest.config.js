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
  "moduleNameMapper": {
    '^html-whitespace-sensitive-tag-names$':
    '<rootDir>/__tests__/fixtures/html-whitespace-sensitive-tag-names.json'
  },
  "modulePathIgnorePatterns": ["__tests__/fixtures"],
  "collectCoverage": false,
  "testEnvironment": "node",
  "collectCoverageFrom": [
    "src/**/*",
    "!**/*.d.ts"
  ]
}
