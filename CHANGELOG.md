## v0.10.1 (2019-11-27)

#### :rocket: New Features
  * [#417](https://github.com/teleporthq/teleport-code-generators/pull/417) feat: publishers throw relevant errors ([@alexnm](https://github.com/alexnm))
  * [#413](https://github.com/teleporthq/teleport-code-generators/pull/413) new function for html encoding ([@alexnm](https://github.com/alexnm))

#### :electric_plug: Angular Generators
  * [#414](https://github.com/teleporthq/teleport-code-generators/pull/414) fix: name cleanup and dependency import in module fix ([@alexnm](https://github.com/alexnm))

#### :electric_plug: Preact Generators
* `teleport-project-generator-preact`
  * [#416](https://github.com/teleporthq/teleport-code-generators/pull/416) chore(project-template): upgrading preact to preactX ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :nail_care: Style Flavours
* `teleport-plugin-react-styled-components`
  * [#415](https://github.com/teleporthq/teleport-code-generators/pull/415) fix(styled-comp): appending prefix when name clashes  ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### Committers: 3
- Alex Moldovan ([@alexnm](https://github.com/alexnm))
- Jaya Krishna Namburu ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
- Utwo ([@Utwo](https://github.com/Utwo))

## v0.10.0-alpha.6 (2019-11-05)

#### :electric_plug: React Generators
* `teleport-project-generator-gatsby`
  * [#398](https://github.com/teleporthq/teleport-code-generators/pull/398) feat(gatsby-proj): support for custom manifest in gatsby ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :electric_plug: Angular Generators
* `teleport-project-generator-angular`
  * [#402](https://github.com/teleporthq/teleport-code-generators/pull/402) refactor(project-template): updating angular project-template ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
* `teleport-plugin-angular-module`
  * [#401](https://github.com/teleporthq/teleport-code-generators/pull/401) refactor(module-angular): switching to modern syntax for lazy loading ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :earth_asia: Core
  * [#400](https://github.com/teleporthq/teleport-code-generators/pull/400) fix: mapping sync with playground ([@alexnm](https://github.com/alexnm))

#### Committers: 2
- Alex Moldovan ([@alexnm](https://github.com/alexnm))
- Jaya Krishna Namburu ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))


## v0.10.0-alpha.5 (2019-10-24)

#### :electric_plug: React Generators
  * [#384](https://github.com/teleporthq/teleport-code-generators/pull/384) feat(proj-gen-gatsby): support for project generators using gatsby ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :electric_plug: Vue Generators
* `teleport-project-generator-gridsome`
  * [#391](https://github.com/teleporthq/teleport-code-generators/pull/391) fix(gridsome-mapping): adding mappings for gridsome ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
* `teleport-code-generator`, `teleport-project-generator-gridsome`, `teleport-test`, `teleport-types`
  * [#388](https://github.com/teleporthq/teleport-code-generators/pull/388) feat(gridsome): generating projects based on gridsome ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :electric_plug: Preact Generators
* `teleport-code-generator`
  * [#387](https://github.com/teleporthq/teleport-code-generators/pull/387) fix(code-generator): fixed bug for picking preact template by default ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :earth_asia: Core
  * [#354](https://github.com/teleporthq/teleport-code-generators/pull/354) WIP: feat(reactnative): project generator initial structure ([@alexnm](https://github.com/alexnm))

#### :bug: Bug Fix
* `teleport-project-generator-next`, `teleport-uidl-resolver`
  * [#389](https://github.com/teleporthq/teleport-code-generators/pull/389) fix: custom mapping logic for navlinks and <a> tags ([@alexnm](https://github.com/alexnm))

#### Committers: 2
- Alex Moldovan ([@alexnm](https://github.com/alexnm))
- Jaya Krishna Namburu ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))


## v0.10.0-alpha.4 (2019-10-15)

#### :rocket: New Features
* `teleport-component-generator-preact`, `teleport-component-generator-react`, `teleport-component-generator-vue`, `teleport-plugin-css`
  * [#385](https://github.com/teleporthq/teleport-code-generators/pull/385) fix: forced scoping added for css plugin and set on vue, react, preact ([@alexnm](https://github.com/alexnm))

#### :electric_plug: Preact Generators
* `teleport-code-generator`, `teleport-project-generator-preact`, `teleport-test`
  * [#382](https://github.com/teleporthq/teleport-code-generators/pull/382) feat(teleport-component-generator): added template for preact codesan… ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### Committers: 3
- Alex Moldovan ([@alexnm](https://github.com/alexnm))
- Balaj Marius ([@balajmarius](https://github.com/balajmarius))
- Jaya Krishna Namburu ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))


## v0.10.0-alpha.3 (2019-10-09)

#### :bug: Bug Fix
* `teleport-component-generator-react`, `teleport-component-generator-stencil`, `teleport-shared`, `teleport-types`, `teleport-uidl-resolver`, `teleport-uidl-validator`
  * [#379](https://github.com/teleporthq/teleport-code-generators/pull/379) feat: string blacklists on mappings and regex validation for some strings in the UIDL ([@alexnm](https://github.com/alexnm))

#### Committers: 1
- Alex Moldovan ([@alexnm](https://github.com/alexnm))


## v0.10.0-alpha.2 (2019-09-30)

#### :electric_plug: Stencil Generators
* `teleport-plugin-stencil-base-component`
  * [#371](https://github.com/teleporthq/teleport-code-generators/pull/371) feat(stencil-base): changing title tag for stencil dynamically ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### Committers: 2
- Alex Moldovan ([@alexnm](https://github.com/alexnm))
- Jaya Krishna Namburu ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))


## v0.10.0-alpha.1 (2019-09-23)

#### :electric_plug: Angular Generators
* `teleport-plugin-angular-base-component`, `teleport-plugin-vue-head-config`, `teleport-postprocessor-prettier-js`, `teleport-types`
  * [#365](https://github.com/teleporthq/teleport-code-generators/pull/365) feat(angular-base): changing title for tab dynamically ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
* `teleport-plugin-angular-base-component`, `teleport-plugin-angular-module`, `teleport-project-generator-angular`
  * [#361](https://github.com/teleporthq/teleport-code-generators/pull/361) tests(angular-module): adding test cases for Angular module generator ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
  * [#357](https://github.com/teleporthq/teleport-code-generators/pull/357) feat(angular-module-gen): Project Generator for Angular using default angular-cli template ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :fire: Refactoring
  * [#366](https://github.com/teleporthq/teleport-code-generators/pull/366) Refactor/shared imports ([@alexnm](https://github.com/alexnm))
  * [#362](https://github.com/teleporthq/teleport-code-generators/pull/362) refactor: rename some fields and simplify logic for routing and paths ([@alexnm](https://github.com/alexnm))

#### Committers: 3
- Alex Moldovan ([@alexnm](https://github.com/alexnm))
- Jaya Krishna Namburu ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
- Utwo ([@Utwo](https://github.com/Utwo))


## v0.10.0-alpha.0 (2019-09-05)

#### :rocket: New Features
  * [#356](https://github.com/teleporthq/teleport-code-generators/pull/356) feat/355 playground packer integration ([@alexnm](https://github.com/alexnm))

#### :electric_plug: Angular Generators
* `teleport-component-generator-angular`, `teleport-component-generator-vue`, `teleport-plugin-angular-base-component`, `teleport-plugin-vue-base-component`, `teleport-shared`
  * [#351](https://github.com/teleporthq/teleport-code-generators/pull/351) fix(angular-base): Handling multiple statements in event handlers ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :electric_plug: Preact Generators
* `teleport-project-generator-preact`, `teleport-project-generator-stencil`, `teleport-project-generator`, `teleport-types`
  * [#348](https://github.com/teleporthq/teleport-code-generators/pull/348) fix(preact-generator): Picking a inbuilt index template and injecting custom tags ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :package: Project Packer
* `teleport-code-generator`, `teleport-publisher-codesandbox`, `teleport-test`
  * [#358](https://github.com/teleporthq/teleport-code-generators/pull/358) feat(publisher): codesandbox integration added ([@alexnm](https://github.com/alexnm))

#### :earth_asia: Core
  * [#353](https://github.com/teleporthq/teleport-code-generators/pull/353) refactor(seo): handling default title and canonical link ([@alexnm](https://github.com/alexnm))
  * [#346](https://github.com/teleporthq/teleport-code-generators/pull/346) feat(meta): added two plugins to handle jsx and vue-meta values per page ([@alexnm](https://github.com/alexnm))
  * [#344](https://github.com/teleporthq/teleport-code-generators/pull/344) Feat/root node restricted to type element ([@alexnm](https://github.com/alexnm))

#### :bug: Bug Fix
* `teleport-component-generator-angular`, `teleport-component-generator-vue`, `teleport-plugin-angular-base-component`, `teleport-plugin-vue-base-component`, `teleport-shared`
  * [#351](https://github.com/teleporthq/teleport-code-generators/pull/351) fix(angular-base): Handling multiple statements in event handlers ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
* `teleport-plugin-stencil-app-routing`
  * [#347](https://github.com/teleporthq/teleport-code-generators/pull/347) refactor(stencil-app-routing): casting dependencies to UIDLDependency… ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
* `teleport-component-generator-preact`, `teleport-plugin-angular-base-component`, `teleport-plugin-vue-base-component`, `teleport-shared`, `teleport-types`, `teleport-uidl-validator`
  * [#343](https://github.com/teleporthq/teleport-code-generators/pull/343) refactor: small fixes ([@alexnm](https://github.com/alexnm))

#### Committers: 2
- Alex Moldovan ([@alexnm](https://github.com/alexnm))
- Jaya Krishna Namburu ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

## v0.9.0 (2019-08-13)

#### :electric_plug: Angular Generators
  * [#335](https://github.com/teleporthq/teleport-code-generators/pull/335) feat(angular-base): Adding Angular generator ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :electric_plug: Stencil Generators
  * [#319](https://github.com/teleporthq/teleport-code-generators/pull/319) feat(stencil): stencil component generator ([@alexnm](https://github.com/alexnm))

#### :electric_plug: Preact Generators
  * [#320](https://github.com/teleporthq/teleport-code-generators/pull/320) feat(preact-project-gen): A Preact project generator ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :nail_care: Style Flavours
  * [#338](https://github.com/teleporthq/teleport-code-generators/pull/338) refactor(css): teleport-plugin-css now works for both html templates and jsx code chunks ([@alexnm](https://github.com/alexnm))
  * [#309](https://github.com/teleporthq/teleport-code-generators/pull/309) fix(plugin-styles): Fix generation of empty styles ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :earth_asia: Core
  * [#334](https://github.com/teleporthq/teleport-code-generators/pull/334) refactor components generated in own folder ([@alexnm](https://github.com/alexnm))
  * [#331](https://github.com/teleporthq/teleport-code-generators/pull/331) refactor(core): template generation syntax is now configurable from base plugins ([@alexnm](https://github.com/alexnm))
  * [#327](https://github.com/teleporthq/teleport-code-generators/pull/327) fix(slots): restrictions for slot node fallback and separate handling for native / prop based slot ([@alexnm](https://github.com/alexnm))
  * [#328](https://github.com/teleporthq/teleport-code-generators/pull/328) feat(postprocessors): factory functions defined with options for configurability ([@alexnm](https://github.com/alexnm))
  * [#314](https://github.com/teleporthq/teleport-code-generators/pull/314) refactor(react-base-plugin): jsx generation extracted to shared package ([@alexnm](https://github.com/alexnm))

#### :bug: Bug Fix
* `teleport-component-generator-react`, `teleport-plugin-react-styled-components`, `teleport-shared`
  * [#318](https://github.com/teleporthq/teleport-code-generators/pull/318) fix(styled-comp): Converting to camel case when passing as props ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
* `teleport-component-generator-vue`, `teleport-plugin-vue-base-component`
  * [#276](https://github.com/teleporthq/teleport-code-generators/pull/276) fix(vue-base-com): Handling non-element root nodes for vue ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :house: Dev Experience
  * [#329](https://github.com/teleporthq/teleport-code-generators/pull/329) feat(Builders): Added project-builders and tests ([@andreiTnu](https://github.com/andreiTnu))
  * [#312](https://github.com/teleporthq/teleport-code-generators/pull/312) feat(build): experimental tasks for react generator ([@alexnm](https://github.com/alexnm))
  * [#313](https://github.com/teleporthq/teleport-code-generators/pull/313) refactor(repl-component): Watcher first builds all packages before wa… ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
  * [#307](https://github.com/teleporthq/teleport-code-generators/pull/307) chore(watcher.js): A Watcher to that triggers for changes in file and rebuild the package ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :fire: Refactoring
  * [#336](https://github.com/teleporthq/teleport-code-generators/pull/336) refactor(css-modules): classname generation optimization and tests for multiple cases ([@alexnm](https://github.com/alexnm))
  * [#333](https://github.com/teleporthq/teleport-code-generators/pull/333) refactor: updated template names and new react template based on cra ([@alexnm](https://github.com/alexnm))
  * [#330](https://github.com/teleporthq/teleport-code-generators/pull/330) refactor(vue): extract html generation syntax into shared package ([@alexnm](https://github.com/alexnm))
  * [#325](https://github.com/teleporthq/teleport-code-generators/pull/325) refactor: standard file and chunk types ([@alexnm](https://github.com/alexnm))
  * [#305](https://github.com/teleporthq/teleport-code-generators/pull/305) refactor(shared): renames, reusability, tests, cleanup, etc. ([@alexnm](https://github.com/alexnm))

#### Committers: 3
- Alex Moldovan ([@alexnm](https://github.com/alexnm))
- Jaya Krishna Namburu ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
- [@andreiTnu](https://github.com/andreiTnu)

## v0.8.0 (2019-06-28)

#### :rocket: New Features
* [#281](https://github.com/teleporthq/teleport-code-generators/pull/281) feat(proj-gen): implement local dependency resolver for components an… ([@alexnm](https://github.com/alexnm))
* [#278](https://github.com/teleporthq/teleport-code-generators/pull/278) feat(Attribute-mapping): Adding mapping for attributes ([@anamariaoros](https://github.com/anamariaoros))

#### :electric_plug: Vue Generator
* [#279](https://github.com/teleporthq/teleport-code-generators/pull/279) Fix/vue default values ([@ionutpasca](https://github.com/ionutpasca))

#### :package: Project Packer
* `teleport-github-gateway`
  * [#282](https://github.com/teleporthq/teleport-code-generators/pull/282) feat: Decode github files using a whitelist ([@ionutpasca](https://github.com/ionutpasca))
* `teleport-publisher-now`
  * [#257](https://github.com/teleporthq/teleport-code-generators/pull/257) refactor(now/src): Changes the name to accessToken from deployToken ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
* `teleport-publisher-github`
  * [#252](https://github.com/teleporthq/teleport-code-generators/pull/252) fix(github-packer): Added master branch and check for commit branch ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :earth_asia: Core
* [#270](https://github.com/teleporthq/teleport-code-generators/pull/270) Feat/246 generic proj gen ([@alexnm](https://github.com/alexnm))

#### :bug: Bug Fix
* `teleport-project-generator`
  * [#291](https://github.com/teleporthq/teleport-code-generators/pull/291) fix(proj-gen): check for file override instead of duplication ([@alexnm](https://github.com/alexnm))
* `teleport-component-generator`, `teleport-uidl-validator`
  * [#290](https://github.com/teleporthq/teleport-code-generators/pull/290) fix(uidl): filename derived from sanitized component name ([@alexnm](https://github.com/alexnm))
* `teleport-uidl-validator`
  * [#261](https://github.com/teleporthq/teleport-code-generators/pull/261) fix(uidl/comp): Validating content if the parent type is static ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
* `teleport-plugin-react-styled-jsx`, `teleport-shared`
  * [#266](https://github.com/teleporthq/teleport-code-generators/pull/266) fix(styled-jsx/index): Injecting style in first child if root is non element ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
* `teleport-publisher-github`
  * [#252](https://github.com/teleporthq/teleport-code-generators/pull/252) fix(github-packer): Added master branch and check for commit branch ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :house: Dev Experience
* `teleport-project-packer-test`
  * [#260](https://github.com/teleporthq/teleport-code-generators/pull/260) chore(packer-test): Used a config file to display the github token ([@andreiTnu](https://github.com/andreiTnu))

#### :fire: Refactoring
* [#273](https://github.com/teleporthq/teleport-code-generators/pull/273) refactor(Extract AST/HAST/JSS util functions into builders) ([@anamariaoros](https://github.com/anamariaoros))
* [#272](https://github.com/teleporthq/teleport-code-generators/pull/272) Refactor/184 deprecate state identifier ([@ionutpasca](https://github.com/ionutpasca))
* [#271](https://github.com/teleporthq/teleport-code-generators/pull/271) Refactor/247 change set generator ([@andreiTnu](https://github.com/andreiTnu))
* [#250](https://github.com/teleporthq/teleport-code-generators/pull/250) refactor: Set default template to the generic packer ([@ionutpasca](https://github.com/ionutpasca))

#### Committers: 5
- Alex Moldovan ([@alexnm](https://github.com/alexnm))
- Anamaria Oros ([@anamariaoros](https://github.com/anamariaoros))
- Jaya Krishna Namburu ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
- Pașca Ionuț ([@ionutpasca](https://github.com/ionutpasca))
- [@andreiTnu](https://github.com/andreiTnu)

## v0.7.0 (2019-06-05)

#### :rocket: New Feature
  * [#227](https://github.com/teleporthq/teleport-code-generators/pull/227) feat(navlinks): transitionTo can now refer to the state key, not the url ([@alexnm](https://github.com/alexnm))
  * [#194](https://github.com/teleporthq/teleport-code-generators/pull/194) (feat): Mongorepo structure by the adopting Lerna ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :electric_plug: React Generators
* `teleport-component-generator-react`, `teleport-generator-shared`, `teleport-plugin-react-base-component`
  * [#212](https://github.com/teleporthq/teleport-code-generators/pull/212) Handling no-element tags as root nodes for generating components ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
* Other
  * [#195](https://github.com/teleporthq/teleport-code-generators/pull/195) (feat): Plugin support for Styled Components ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
  * [#201](https://github.com/teleporthq/teleport-code-generators/pull/201) fix(style-flavours): Fixed style flavours w.r.t to their behaviour ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :electric_plug: Vue Generator
* `teleport-plugin-vue-base-component`
  * [#231](https://github.com/teleporthq/teleport-code-generators/pull/231) fix(vue-base-component): Support for nested conditionals in Vue ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :nail_care: Style Flavours
* `teleport-component-generator-react`, `teleport-generator-shared`, `teleport-plugin-react-styled-components`
  * [#216](https://github.com/teleporthq/teleport-code-generators/pull/216) fix(react-styled-components): Fixed of adding styled by default ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
* Other
  * [#195](https://github.com/teleporthq/teleport-code-generators/pull/195) (feat): Plugin support for Styled Components ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
  * [#201](https://github.com/teleporthq/teleport-code-generators/pull/201) fix(style-flavours): Fixed style flavours w.r.t to their behaviour ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :package: Project Packer
  * [#249](https://github.com/teleporthq/teleport-code-generators/pull/249) Feature/234 GitHub gateway ([@ionutpasca](https://github.com/ionutpasca))
  * [#232](https://github.com/teleporthq/teleport-code-generators/pull/232) (feat-#197) Project Packers and publishers, supporting publish for netlify, now, local dist and zip. ([@ionutpasca](https://github.com/ionutpasca))

#### :earth_asia: Core
  * [#225](https://github.com/teleporthq/teleport-code-generators/pull/225) feat(proj-gen): reusing linker functionality + formatting from generic component generators ([@alexnm](https://github.com/alexnm))
  * [#218](https://github.com/teleporthq/teleport-code-generators/pull/218) feat(component-gen): A Generic component generatorby splitting post processing. ([@alexnm](https://github.com/alexnm))

#### :bug: Bug Fix
  * [#231](https://github.com/teleporthq/teleport-code-generators/pull/231) fix(vue-base-component): Support for nested conditionals in Vue ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
  * [#224](https://github.com/teleporthq/teleport-code-generators/pull/224) Feature/validator extension + bug fix  ([@anamariaoros](https://github.com/anamariaoros))
  * [#221](https://github.com/teleporthq/teleport-code-generators/pull/221) feat(plugin-react-proptypes): Added isRequired attribute for proptypes ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
  * [#223](https://github.com/teleporthq/teleport-code-generators/pull/223) Fix/#175 Components name are same as generated from Router ([@alexnm](https://github.com/alexnm))
  * [#212](https://github.com/teleporthq/teleport-code-generators/pull/212) Handling no-element tags as root nodes for generating components ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
  * [#216](https://github.com/teleporthq/teleport-code-generators/pull/216) fix(react-styled-components): Fixed of adding styled by default ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
  * [#201](https://github.com/teleporthq/teleport-code-generators/pull/201) fix(style-flavours): Fixed style flavours w.r.t to their behaviour ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :crystal_ball: UIDL
  * [#224](https://github.com/teleporthq/teleport-code-generators/pull/224) Feature/validator extension + bug fix  ([@anamariaoros](https://github.com/anamariaoros))
  * [#221](https://github.com/teleporthq/teleport-code-generators/pull/221) feat(plugin-react-proptypes): Added isRequired attribute for proptypes ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
  * [#219](https://github.com/teleporthq/teleport-code-generators/pull/219) refactor(generator-core): Schema to support array as  a default value ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
  * [#173](https://github.com/teleporthq/teleport-code-generators/pull/173) refactor(uidl-samples/component-schema): Update component schema to a… ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :house: Dev Experience
  * [#241](https://github.com/teleporthq/teleport-code-generators/pull/241) Feat/240 prep for release ([@alexnm](https://github.com/alexnm))
  * [#228](https://github.com/teleporthq/teleport-code-generators/pull/228) chore: add tests for plugins and generic component generator ([@alexnm](https://github.com/alexnm))
  * [#220](https://github.com/teleporthq/teleport-code-generators/pull/220) Tests ([@anamariaoros](https://github.com/anamariaoros))

#### Committers: 5
- Alex Moldovan ([@alexnm](https://github.com/alexnm))
- Anamaria Oros ([@anamariaoros](https://github.com/anamariaoros))
- Jaya Krishna Namburu ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
- Luca Guzzon ([@lguzzon](https://github.com/lguzzon))
- Pașca Ionuț ([@ionutpasca](https://github.com/ionutpasca))

## v0.6.0 (2019-04-09)

#### :crystal_ball: UIDL
* [#143](https://github.com/teleporthq/teleport-code-generators/pull/143) feat(uidl-schema): uidl-schema-update ([@anamariaoros](https://github.com/anamariaoros))

#### Committers: 4
- Alex Moldovan ([@alexnm](https://github.com/alexnm))
- Anamaria Oros ([@anamariaoros](https://github.com/anamariaoros))
- Jaya Krishna Namburu ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
- Vlad Nicula ([@vladnicula](https://github.com/vladnicula))


## v0.5.1 (2019-04-04)

#### :electric_plug: React Generators
* [#144](https://github.com/teleporthq/teleport-code-generators/pull/144) feat(conditional render): support props as conditional identifier ([@alexnm](https://github.com/alexnm))

#### :electric_plug: Vue Generator
* [#144](https://github.com/teleporthq/teleport-code-generators/pull/144) feat(conditional render): support props as conditional identifier ([@alexnm](https://github.com/alexnm))

#### Committers: 4
- Alex Moldovan ([@alexnm](https://github.com/alexnm))
- Pașca Ionuț ([@ovidiuionut94](https://github.com/ovidiuionut94))
- Vlad Nicula ([@vladnicula](https://github.com/vladnicula))
- [@alexpausan](https://github.com/alexpausan)


## v0.5.0 (2019-04-03)

#### :rocket: New Feature
* Component generators should validate input UIDL ([@alexnm](https://github.com/alexnm))

#### :electric_plug: React Generators
* [#89](https://github.com/teleporthq/teleport-code-generators/pull/89) Ternary Expression for boolean states ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### :electric_plug: Vue Generator
* [#116](https://github.com/teleporthq/teleport-code-generators/pull/116) refactor(html-to-util-string): Switching the HAST to Html builder for… ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
* [#103](https://github.com/teleporthq/teleport-code-generators/pull/103) Ternary Expressions for Vue ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
* [#83](https://github.com/teleporthq/teleport-code-generators/pull/83) vue generators on par with react ([@alexnm](https://github.com/alexnm))

#### :earth_asia: Core
* [#135](https://github.com/teleporthq/teleport-code-generators/pull/135) fix(try-catch-removal): removing try catch from assembly line-plugins ([@anamariaoros](https://github.com/anamariaoros))

#### :crystal_ball: UIDL
* [#82](https://github.com/teleporthq/teleport-code-generators/pull/82) refactor(schemas): Updated schemas with enum values ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

#### Committers: 6
- Alex Moldovan ([@alexnm](https://github.com/alexnm))
- Anamaria Oros ([@anamariaoros](https://github.com/anamariaoros))
- Jaya Krishna Namburu ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
- Paul BRIE ([@paulbrie](https://github.com/paulbrie))
- Pașca Ionuț ([@ovidiuionut94](https://github.com/ovidiuionut94))
- Vlad Nicula ([@vladnicula](https://github.com/vladnicula))


## v0.4.0 (2019-03-07)

#### :electric_plug: Vue Generator
* [#65](https://github.com/teleporthq/teleport-code-generators/pull/65) fix(vue formatting): html parser update for prettier ([@alexnm](https://github.com/alexnm))

#### :earth_asia: Core
* [#71](https://github.com/teleporthq/teleport-code-generators/pull/71) Cleanup builder and chunk ([@alexnm](https://github.com/alexnm))

#### Committers: 3
- Alex Moldovan ([@alexnm](https://github.com/alexnm))
- Mihai Serban ([@mihaiserban](https://github.com/mihaiserban))
- Paul BRIE ([@paulbrie](https://github.com/paulbrie))