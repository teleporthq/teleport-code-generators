## v0.7.0 (2019-06-05)

#### :rocket: New Feature
  * [#232](https://github.com/teleporthq/teleport-code-generators/pull/232) (feat-#197) Project Packers and publishers, supporting publish for netlify, now, local dist and zip. ([@ionutpasca](https://github.com/ionutpasca))
  * [#227](https://github.com/teleporthq/teleport-code-generators/pull/227) feat(navlinks): transitionTo can now refer to the state key, not the url ([@alexnm](https://github.com/alexnm))
  * [#218](https://github.com/teleporthq/teleport-code-generators/pull/218) feat(component-gen): A Generic component generatorby splitting post processing. ([@alexnm](https://github.com/alexnm))
  * [#194](https://github.com/teleporthq/teleport-code-generators/pull/194) (feat): Mongorepo structure by the adopting Lerna ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))
  * [#195](https://github.com/teleporthq/teleport-code-generators/pull/195) (feat): Plugin support for Styled Components ([@JayaKrishnaNamburu](https://github.com/JayaKrishnaNamburu))

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