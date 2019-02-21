module.exports = {
  "transform": {
    "^.+\\.ts?$": "ts-jest"
  },
  "testRegex": "(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$",
  "moduleFileExtensions": [
    "ts",
    "tsx",
    "js",
    "jsx",
    "node"
  ],
  "collectCoverage": false,
  "testEnvironment": "node",
  "collectCoverageFrom": [
    "src/**/*",
    "!**/*.d.ts"
  ]
}
