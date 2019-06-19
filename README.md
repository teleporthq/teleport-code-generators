<p align="center">
  <img src="https://github.com/teleporthq/teleport-code-generators/blob/master/Default.png" width="250"/>
</p>

<h2 align="center">Code Generators v0.7 - Beta!</h2>

<h3 align="center">
  <a href="#what">What</a>
  <span> · </span>
  <a href="#quick-setup">Quick Setup</a>
  <span> · </span>
  <a href="#features">Features</a>
  <span> · </span>
  <a href="https://docs.teleporthq.io">Documentation</a>
  <span> · </span>
  <a href="#development">Development</a>
  <span> · </span>
  <a href="#planning">Planning</a>
  <span> · </span>
  <a href="#contributions">Contributions</a>
</h3>

<p align="center">
  <a target="_blank" href="https://www.npmjs.com/package/@teleporthq/teleport-component-generator"><img src="https://img.shields.io/npm/v/@teleporthq/teleport-component-generator.svg" /></a>
  <a target="_blank" href="https://travis-ci.org/teleporthq/teleport-code-generators"><img src="https://travis-ci.org/teleporthq/teleport-code-generators.svg?branch=master" /></a>
  <a target="_blank" href="https://codecov.io/gh/teleporthq/teleport-code-generators"><img src="https://codecov.io/gh/teleporthq/teleport-code-generators/branch/master/graph/badge.svg" /></a>
  <a target="_blank" href="https://github.com/prettier/prettier"><img src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg" /></a>
  <img src="https://img.shields.io/npm/l/@teleporthq/teleport-code-generators.svg" />
  <a target="_blank" href="https://twitter.com/teleporthqio"><img src="https://img.shields.io/twitter/follow/teleporthqio.svg" /></a>
</p>

We are not far from the **first official version** of the code generators, but meanwhile, keep in mind that this is not yet production ready!

<h2 id="what">🤔 What is this?</h2>

The **code generators** are a part of the **teleportHQ** ecosystem, which we're actively building in an effort to streamline the creation of web and mobile applications. You can read more about our inception in [this article](https://teleporthq.io/blog/we-believe-in-AI-powered-code-generation/).

The code generators are used by the online **visual editor** (coming soon), a platform that lets you build applications via a familiar design tool interface. The glue between the platform and the code generators is the [**UIDL Standard**](https://docs.teleporthq.io/uidl/). The **UIDL** defines the **user interfaces** in an **abstract** way, independent of any framework or even the web platform itself. Starting from the UIDL, you can convert that abstraction into different flavors of coding (e.g. React, Vue, WebComponents etc.).

The philosophy behind the code generators is:
* User interfaces are decomposed into **components**, hence the focus on component generation
* What can be built with `React`, can also be built with `Vue` or on top of the `Web Components` standard - we support multiple targets
* A project built with the visual editor should have a **high standard of quality** (performance, security, accessibility included)
* Generated **code quality** should be as high as possible, so that any developer could pick up the work from there on and enhance the project
* The code generation architecture is open and extendable, we invite everyone to contribute!

Read more about the [UIDL Standard](https://docs.teleporthq.io/uidl/).

<h2 id="quick-setup">🚀 Quick Setup</h2>

### Using a preconfigured component generator

The easiest way to jump into the teleport ecosystem is to try out one of the pre-configured **component generators**:
```bash
npm install @teleporthq/teleport-component-generator-react
npm install @teleporthq/teleport-component-generator-vue
```
or using yarn:
```bash
yarn add @teleporthq/teleport-component-generator-react
yarn add @teleporthq/teleport-component-generator-vue
```

For generating a simple component, you have to start from a **component UIDL**:

```json
{
  "name": "My First Component",
  "node": {
    "type": "element",
    "content": {
      "elementType": "text",
      "children": [
        {
          "type": "static",
          "content": "Hello World!"
        }
      ]
    }
  }
}
```

Using the pre-configured component generators is as easy as calling an *async* function:

```javascript
import ReactGenerator from '@teleporthq/teleport-component-generator-react'

const uidl = { ... } // your sample here

const { files } = await ReactGenerator.generateComponent(uidl)
console.log(files[0].content)
```
The console output will be something like:
```javascript
import React from 'react'

const MyFirstComponent = (props) => {
  return <span>Hello World!</span>
}

export default MyFirstComponent
```

For the `Vue` generator, just switch the package:
```javascript
import VueGenerator from '@teleporthq/teleport-component-generator-vue'

const uidl = { ... } // your sample here

const { files } = await VueGenerator.generateComponent(uidl)
console.log(files[0].content)
```
The console output will be something like:
```vue
<template>
  <span>Hello World!</span>
</template>

<script>
export default {
  name: 'MyFirstComponent',
}
</script>
```

You can play with the UIDL structure and also observe the generated code in [the online REPL](https://repl.teleporthq.io/).

### Building your custom component generator
All the preconfigured component generators are exposing an instance of the `teleport-component-generator` package. Naturally, you can install the package and build your own generator with [plugins](https://docs.teleporthq.io/component-generators/plugins.html), [mappings](https://docs.teleporthq.io/component-generators/mappings.html) and [postprocessors](https://docs.teleporthq.io/component-generators/post-processors.html).

Let's configure a `React` component generator that uses `styled-jsx` and formats all code with `prettier`:

First install the dependencies:
```
npm install @teleporthq/teleport-component-generator
npm install @teleporthq/teleport-plugin-react-base-component
npm install @teleporthq/teleport-plugin-react-styled-jsx
npm install @teleporthq/teleport-plugin-react-proptypes
npm install @teleporthq/teleport-plugin-import-statements
npm install @teleporthq/teleport-postprocessor-prettier-js
```

Then, we import all dependencies and we create the component generator, using the factory, a named export from the module:

```javascript
import { createComponentGenerator } from '@teleporthq/teleport-component-generator'
import reactPlugin from '@teleporthq/teleport-plugin-react-base-component'
import styledJSXPlugin from '@teleporthq/teleport-plugin-react-styled-jsx'
import propTypesPlugin from '@teleporthq/teleport-plugin-react-proptypes'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'
import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

const generator = createComponentGenerator()
```

Next, we have to consider any specific **mapping** for React. By default, the `teleport-component-generator` performs a mapping from the abstract UIDL elements to HTML elements.

Jump to the [mappings section](https://docs.teleporthq.io/component-generators/mappings.html#file-structure) to better understand the structure of a mapping file. A React mapping could look like this:

```json
{
  "elements": {
    "group": {
      "elementType": "Fragment",
      "dependency": {
        "type": "library",
        "path": "react",
        "meta": {
          "namedImport": true
        }
      }
    }
  }
}
```

The **official `React` mapping** is maintained inside [`teleport-component-generator-react`](https://github.com/teleporthq/teleport-code-generators/blob/master/packages/teleport-component-generator-react/src/react-mapping.json)

Add the mapping:
```javascript
import reactMapping from './react-mapping.json'

generator.addMapping(reactMapping)
```

> You can add as many mappings as you wish on one generator, they will override the elements and events that were previously mapped with the same key.

Next, we can add all our **plugins** to the existing generator. Note that the **order** of the plugins is important as they will be run in **sequence** on the input UIDL:

```javascript
generator.addPlugin(reactPlugin) // the base plugin needs to be the first one!
generator.addPlugin(styledJSXPlugin)
generator.addPlugin(propTypesPlugin)
generator.addPlugin(importStatementsPlugin)
```

Finally, we can add the post-processors:

```javascript
generator.addPostProcessor(prettierJS)
```

Now, we can test the generator. Considering the following UIDL:

```json
{
  "name": "React Component",
  "node": {
    "type": "element",
    "content": {
      "elementType": "container",
      "children": [
        {
          "type": "element",
          "content": {
            "elementType": "text",
            "style": {
              "color": {
                "type": "static",
                "content": "red"
              }
            },
            "children": [
              {
                "type": "static",
                "content": "World!"
              }
            ]
          }
        }
      ]
    }
  }
}
```

calling the generator:

```javascript
await generator.generateComponent(uidl)
```

should yield:

```javascript
import React from 'react'

const ReactComponent = (props) => {
  return (
    <div>
      <span className="text">World!</span>
      <style jsx>
        {`
          .text {
            color: red;
          }
        `}
      </style>
    </div>
  )
}

export default ReactComponent
```

<h2 id="features">💼 Features</h2>

The teleport ecosystem consists of **three** main categories of packages: *component generators*, *project generators* and *project packers*.

### Component Generators
We have **official** component generators for `React` and `Vue`, but we also plan on supporting other frameworks and standards as soon as possible. Also, `React Native` is definitely on our minds, since we've designed the UIDL in such a way that it's agnostic of the web platform.

All component generators are built on top of the generic `teleport-component-generator` package that offers the underlying structure. Check out the [official docs](https://docs.teleporthq.io/component-generators/) for an in depth understanding of the architecture behind the component generators.

#### Flavors
* `teleport-component-generator-react` - with styling: `css-modules`, `styled-components`, `styled-jsx`, etc.
* `teleport-component-generator-vue` - generating standard `.vue` files
* teleport-component-generator-angular (coming soon)
* teleport-component-generator-webcomponent (coming soon)

#### Capabilities
Here's a list of functionalities that the UIDL and the component generators are supporting at the moment, besides the obvious presentational layer:
*  Dynamic values (props, state) inside html nodes or at attribute level
*  Type definitions for component props (PropTypes in React, props in Vue)
*  External dependencies definition
*  Simple component state (using hooks in React, component instance in Vue)
*  Event Handlers (related to state changes)
*  Repeat structures (.map in React, v-for in Vue)
*  Support for slots

### Project Generators
Project generators rely on the component generators and on the structure of the `ProjectUIDL` to figure out how many files to create and where to create them. The project generators will output an abstract structure with folders and files, without writing anything to disk. The project packer is tasked with taking the output of a project generator and publishing it somewhere.

#### Flavors
* `teleport-project-generator-react-basic` - `react` + `react-router` and `css-modules` setup
* `teleport-project-generator-react-next` - based on [Next.js](https://nextjs.org/)
* `teleport-project-generator-vue-basic` - with a structure starting from the `vue-cli`
* `teleport-project-generator-vue-nuxt` - based on [Nuxt.js](https://nuxtjs.org/)
* teleport-project-generator-react-native (coming soon)
* teleport-project-generator-angular (coming soon)
* teleport-project-generator-gatsby (coming soon)
* teleport-project-generator-static (coming soon)

#### Capabilities
Besides the regular files and folders generated at the end of the process, project generators are also taking care of:
* Support for global settings, meta tags, style, scripts, etc.
* Extracting all external dependencies and adding them to the `package.json`
* Creating the entry point for each application (it can be an `index.html` or something that is framework specific)
* Generating a web manifest for PWA support

### Project Packers
Once a generator created the code for the components and pages, the **project packer** will take that output, put it on top of an existing **project template**, add any local **assets** required and then will pass the entire result to a **publisher**. The publishers are specialized in deploying the entire folder structure to a 3rd party like `now` or `github`, or in creating an in-memory `zip` file or simply writing the folder to `disk`.

#### Publishers
* `teleport-publisher-now`
* `teleport-publisher-netlify`
* `teleport-publisher-github`
* `teleport-publisher-zip`
* `teleport-publisher-disk`

### Further Reading
A few useful links to get you up to speed with the entire **teleport** ecosystem:
* [Full Documentation](https://docs.teleporthq.io/)
* [Component](https://docs.teleporthq.io/uidl-schema/v1/component.json) and [Project](https://docs.teleporthq.io/uidl-schema/v1/project.json) JSON Schemas
* [Online REPL](https://repl.teleporthq.io/)

<h2 id="development">💻 Development</h2>

This project uses:
* [TypeScript](https://www.typescriptlang.org/) for type safety and easy refactoring
* [lerna](https://github.com/lerna/lerna) for managing the monorepo with multiple npm packages
* [jest](https://jestjs.io/) for all types of tests and for calculating the code coverage

In order to give it a spin locally, we recommend using `yarn`, as it integrates better with `lerna` and all the contributors are using it:

```
yarn
```
This installs the dependencies in the root folder, but also creates the symlinks between the independent modules inside the `packages` folder.

To complete the lerna setup, you need to run:

```
yarn build
```
This will run the `build` task inside each individual package, creating the output `lib` folder.

Running the test suite:
```
yarn test
yarn test:coverage
```

Furthermore, there's a `private` package inside the lerna folder called `teleport-project-packer-test`. That packages can be used to **test** the code/file generation process with any flavor of project/component generator. In order to give it a spin you will have to run:

```
cd packages/teleport-project-packer-test
cp config.example.json config.json

```

You will have to replace the placeholder with [your own github token](https://help.github.com/en/articles/creating-a-personal-access-token-for-the-command-line).
Then you can run it with:

```
npm start
```
This version of the packer uses the UIDLs from the `examples/uidl-sample`. If the process runs successfully, you will see the responoses from the project packer in the format: `{ success: true, payload: 'dist' }`. The task uses the `teleport-publisher-disk` package and generates four different project files in the `dist` folder.

Please [open an issue](https://github.com/teleporthq/teleport-code-generators/issues) for any irregularity, potential bug that you find while running this, or if you simply have any questions or curiosities about this project.

<h2 id="planning">🤖 Planning</h2>

It's not just our code that's open source, we're also planning the development of the code generators on GitHub. We have [a number of issues](https://github.com/teleporthq/teleport-code-generators/issues) opened and we expect further contributions on this.

We're especially interested in opening discussions around the issues tagged with the [`discussion`](https://github.com/teleporthq/teleport-code-generators/issues?q=is%3Aissue+is%3Aopen+label%3Adiscussion) label.

### Official Release
The official release will be a switch to version `1.0`. ETA for this is around mid July 2019.

<h2 id="contributions">💕 Contributions</h2>

We'd be super happy to have **community** involvement around this project. We strongly believe in the power of **open source**, so we're planning on building the best possible code generators, together with the entire development community.

We envision different types of involvement from this point on:
* Trying out the generators and reporting back any bugs and potential points of improvement
* Contributing to the existing issues, either on the core modules or on the existing generators and plugins
* Exploring and building new plugins for the existing generators
* Exploring and building new generators based on the existing architecture

Thanks goes to these wonderful people ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore -->
<table><tr><td align="center"><a href="https://medium.com/@alexnm"><img src="https://avatars0.githubusercontent.com/u/9945366?v=4" width="100px;" alt="Alex Moldovan"/><br /><sub><b>Alex Moldovan</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=alexnm" title="Code">💻</a> <a href="https://github.com/teleporthq/teleport-code-generators/commits?author=alexnm" title="Documentation">📖</a> <a href="#ideas-alexnm" title="Ideas, Planning, & Feedback">🤔</a></td><td align="center"><a href="https://github.com/vladnicula"><img src="https://avatars3.githubusercontent.com/u/126038?v=4" width="100px;" alt="Vlad Nicula"/><br /><sub><b>Vlad Nicula</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=vladnicula" title="Code">💻</a> <a href="#ideas-vladnicula" title="Ideas, Planning, & Feedback">🤔</a></td><td align="center"><a href="https://github.com/paulbrie"><img src="https://avatars2.githubusercontent.com/u/3997538?v=4" width="100px;" alt="Paul BRIE"/><br /><sub><b>Paul BRIE</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/issues?q=author%3Apaulbrie" title="Bug reports">🐛</a> <a href="https://github.com/teleporthq/teleport-code-generators/commits?author=paulbrie" title="Documentation">📖</a> <a href="#ideas-paulbrie" title="Ideas, Planning, & Feedback">🤔</a></td><td align="center"><a href="https://github.com/mihaitaba"><img src="https://avatars3.githubusercontent.com/u/45386599?v=4" width="100px;" alt="mihaitaba"/><br /><sub><b>mihaitaba</b></sub></a><br /><a href="#design-mihaitaba" title="Design">🎨</a> <a href="https://github.com/teleporthq/teleport-code-generators/commits?author=mihaitaba" title="Documentation">📖</a></td><td align="center"><a href="https://github.com/mihaiserban"><img src="https://avatars2.githubusercontent.com/u/3420526?v=4" width="100px;" alt="Mihai Serban"/><br /><sub><b>Mihai Serban</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=mihaiserban" title="Code">💻</a></td><td align="center"><a href="https://twitter.com/askjkrishna"><img src="https://avatars0.githubusercontent.com/u/11075561?v=4" width="100px;" alt="Jaya Krishna Namburu"/><br /><sub><b>Jaya Krishna Namburu</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=JayaKrishnaNamburu" title="Code">💻</a> <a href="https://github.com/teleporthq/teleport-code-generators/issues?q=author%3AJayaKrishnaNamburu" title="Bug reports">🐛</a></td><td align="center"><a href="https://github.com/anamariaoros"><img src="https://avatars0.githubusercontent.com/u/17590608?v=4" width="100px;" alt="Anamaria Oros"/><br /><sub><b>Anamaria Oros</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=anamariaoros" title="Code">💻</a></td></tr><tr><td align="center"><a href="https://github.com/ovidiuionut94"><img src="https://avatars3.githubusercontent.com/u/11486739?v=4" width="100px;" alt="ovidiuionut94"/><br /><sub><b>ovidiuionut94</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=ovidiuionut94" title="Code">💻</a></td><td align="center"><a href="https://github.com/alexpausan"><img src="https://avatars0.githubusercontent.com/u/3284064?v=4" width="100px;" alt="alexpausan"/><br /><sub><b>alexpausan</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=alexpausan" title="Code">💻</a></td><td align="center"><a href="https://github.com/mihaisampaleanu"><img src="https://avatars1.githubusercontent.com/u/6763756?v=4" width="100px;" alt="Mihai Sampaleanu"/><br /><sub><b>Mihai Sampaleanu</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=mihaisampaleanu" title="Code">💻</a></td><td align="center"><a href="http://utwo.ro"><img src="https://avatars1.githubusercontent.com/u/282668?v=4" width="100px;" alt="Utwo"/><br /><sub><b>Utwo</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=Utwo" title="Code">💻</a></td><td align="center"><a href="https://github.com/andreiTnu"><img src="https://avatars1.githubusercontent.com/u/51601382?v=4" width="100px;" alt="andreiTnu"/><br /><sub><b>andreiTnu</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=andreiTnu" title="Code">💻</a></td><td align="center"><a href="https://codepen.io/xavxyz"><img src="https://avatars0.githubusercontent.com/u/13962779?v=4" width="100px;" alt="Xavier Cazalot"/><br /><sub><b>Xavier Cazalot</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=xavxyz" title="Code">💻</a></td></tr></table>

<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind welcome!

<h2 id="contact">✍️ Contact</h2>

Reach out to us on any of these channels:
* 📧 [Write an Email](mailto:hello@teleporthq.io)
* 🐦 [Drop a message on twitter](https://twitter.com/teleporthqio)
* ℹ️ [Website](https://teleporthq.io/)
