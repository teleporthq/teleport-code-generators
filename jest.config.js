module.exports = {
  "transform": {
    "^.+\\.ts?$": "ts-jest"
  },
  'globals': {
    'ts-jest': {
      'diagnostics': {
        'warnOnly': true
      },
      // The packages build with target ES2017 (see packages/*/tsconfig.json),
      // but the root tsconfig ts-jest picks up targets ES5 — under which
      // `for (const [k, v] of someMap)` compiles (warnOnly hides TS2802) into
      // code that silently iterates NOTHING. Tests exercising Map/Set
      // iteration paths passed vacuously or failed mysteriously. Compile tests
      // the way the packages actually ship.
      'tsconfig': {
        'target': 'ES2017'
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
