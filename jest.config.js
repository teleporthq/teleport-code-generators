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
  "testPathIgnorePatterns": ['mocks.ts', '/__tests__/_helpers/'],
  "moduleNameMapper": {
    '^html-whitespace-sensitive-tag-names$':
      '<rootDir>/test-mocks/html-whitespace-sensitive-tag-names.json'
  },
  "collectCoverage": false,
  "testEnvironment": "node",
  "collectCoverageFrom": [
    "packages/**/src/**/*",
    "!packages/teleport-test/**/*",
    "!packages/teleport-types/**/*",
    "!packages/teleport-plugin-next-workflows/src/nodes/**/*"
  ],
  // Workflow node handlers are emitted as runtime source via fn.toString() and
  // eval'd by their tests. Istanbul instrumentation injects `cov_xxx()` calls
  // inside those function bodies that the eval scope cannot resolve, so the
  // entire handlers directory is excluded from instrumentation.
  "coveragePathIgnorePatterns": [
    "/node_modules/",
    "/packages/teleport-plugin-next-workflows/src/nodes/"
  ]
}
