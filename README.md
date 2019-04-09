<p align="center">
  <img src="https://github.com/teleporthq/teleport-code-generators/blob/master/Default.png" width="250"/>
</p>

<h2 align="center">Code Generators v0.6 - Alpha!</h2>

<h3 align="center">
  <a href="#what">What</a>
  <span> · </span>
  <a href="#quick-setup">Quick Setup</a>
  <span> · </span>
  <a href="#features">Features</a>
  <span> · </span>
  <a href="#development">Development</a>
  <span> · </span>
  <a href="#planning">Planning</a>
  <span> · </span>
  <a href="#contributions">Contributions</a>
</h3>

<p align="center">
  <a target="_blank" href="https://www.npmjs.com/package/@teleporthq/teleport-code-generators"><img src="https://img.shields.io/npm/v/@teleporthq/teleport-code-generators.svg" /></a>
  <a target="_blank" href="https://travis-ci.org/teleporthq/teleport-code-generators"><img src="https://travis-ci.org/teleporthq/teleport-code-generators.svg?branch=master" /></a>
  <a target="_blank" href="https://codecov.io/gh/teleporthq/teleport-code-generators"><img src="https://codecov.io/gh/teleporthq/teleport-code-generators/branch/master/graph/badge.svg" /></a>
  <a target="_blank" href="https://github.com/prettier/prettier"><img src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg" /></a>
  <img src="https://img.shields.io/npm/l/@teleporthq/teleport-code-generators.svg" />
  <a target="_blank" href="https://bundlephobia.com/result?p=@teleporthq/teleport-code-generators"><img src="https://img.shields.io/bundlephobia/minzip/@teleporthq/teleport-code-generators.svg" /></a>
  <a target="_blank" href="https://twitter.com/teleporthqio"><img src="https://img.shields.io/twitter/follow/teleporthqio.svg" /></a>
</p>

This is a **WIP prototype** containing all of our project and component generators, as well as the **UIDL** schemas and validators. While we have some working examples, it shouldn't be considered production ready by any means! Don't hesitate to give us feedback and feel free to contribute in any way!

<h2 id="what">🤔 What is this?</h2>

The **code generators** are a part of the **teleportHQ** ecosystem, which we're actively building in an effort to streamline the creation of web and mobile applications. You can read more about our inception in [this article](https://teleporthq.io/blog/we-believe-in-AI-powered-code-generation/).

The code generators are used by our online **visual editor** (coming soon), a platform that lets you build applications via a familiar design tool interface. The glue between our platform and the code generators is the [**UIDL Standard**](link coming soon). The UIDL allows us to define **user interfaces** in an **abstract** way, independent of any framework or even the web platform itself, which then allows us to convert that abstraction into different flavors of coding (e.g. React, Vue, etc.).

Our philosophy behind the code generators is:
* User interfaces are decomposed into **components**, hence our focus on component generation
* What can be built with `React`, can also be built with `Vue` or on top of the `Web Components` standard - we support multiple targets
* A project built with the visual editor should have a **high standard of quality** (performance, security, accessibility included)
* Generated **code quality** should be as high as possible, so that any developer could pick up the work from there on and enhance the project
* The code generation architecture is open and extendable, we invite everyone to contribute!

You can also read more on our [decision to open source our code generators](link coming soon).

Read more about the [UIDL Standard](link coming soon).

<h2 id="quick-setup">🚀 Quick Setup</h2>

While this will probably remain a [monorepo](https://danluu.com/monorepo/), we'll publish different **npm** packages for various parts of our code generation ecosystem. For now, there's a single package published under `@teleporthq/teleport-code-generators`. So, let's integrate that into your project:

```bash
npm install @teleporthq/teleport-code-generators
```

```javascript
import { createReactComponentGenerator } from '@teleporthq/teleport-code-generators'

// instantiate a react generator
const reactGenerator = createReactComponentGenerator()

// define a UIDL representation
const componentUIDL = {
  "name": "MyComponent",
  "node": {
    "type": "element",
    "content": {
      "elementType": "text", // equivalent of the span
      "children": [{
        "type": "static", // equivalent of the text node inside
        "content": "Teleport World!"
      }]
    }
  }
}

// get the code
reactGenerator
  .generateComponent(componentUIDL)
  .then(result => {
    console.log(result.code)
  })
  .catch(err => {
    console.log(err)
  })
```

The code output from this snippet would be
```jsx
import React from "react"

const MyComponent = props => {
  return <span>Teleport World!</span>
}

export default MyComponent
```

You can find more advanced UIDL samples to play with [here](https://github.com/teleporthq/teleport-code-generators/tree/master/examples/uidl-samples).

<h2 id="features">💼 Features</h2>

This repo contains multiple **modules** that will soon be available as individual `npm` **packages**. There are two types of generators available: component and project generators. Component generators take a simple **ComponentUIDL** input and return the **code** according to the specific generator flavors (e.g. React + StyledJSX, Vue, etc.). Project generators operate on **ProjectUIDL**s and will return a complete structure of `folders` and `files` which then can be written to disk or sent to servers for deployment. The aim of the project generators is to output a **working application**.

### Component Generators

We have **official** component generators for `React` and `Vue`, but we also plan on supporting other frameworks and standards as soon as possible. Also, `React Native` is definitely on our minds, since we've designed the UIDL in such a way that it's agnostic of the web platform.

There are two **factory functions** exported from our main module, for the React and Vue generators.

#### React

```javascript
import { createReactComponentGenerator } from '@teleporthq/teleport-code-generators'

// define a UIDL representation
const componentUIDL = {
  "name": "MyComponent",
  "node": {
    "type": "element",
    "content": {
      "elementType": "text",
      "children": [{
        "type": "static",
        "content": "Teleport World!"
      }]
    }
  }
}

// instantiate a generator, selecting the styled-jsx plugin for handling styles (other options: CSSModules, JSS, InlineStyles)
const reactGenerator = createReactComponentGenerator({ variation: 'StyledJSX' })

// get the code
reactGenerator
  .generateComponent(componentUIDL)
  .then(result => {
    console.log(result.code)
  })
  .catch(err => {
    console.log(err)
  })
```

Read more about [the API of the component generator](link coming soon).

Read more about [mappings and resolvers](link coming soon).

#### Vue

```javascript
import { createVueComponentGenerator } from '@teleporthq/teleport-code-generators'

// define a UIDL representation 
const componentUIDL = {
  "name": "MyComponent",
  "node": {
    "type": "element",
    "content": {
      "elementType": "text", // equivalent of the span
      "children": [{
        "type": "static", // equivalent of the text node inside
        "content": "Teleport World!"
      }]
    }
  }
}

// instantiate a vue generator
const vueGenerator = createVueComponentGenerator()

// get the code
vueGenerator
  .generateComponent(componentUIDL)
  .then(result => {
    console.log(result.code)
  })
  .catch(err => {
    console.log(err)
  })
```

#### Advanced capabilities
Here's a list of functionalities that the UIDL and the component generators are supporting at the moment, besides the obvious presentational layer:
*  Dynamic values (props, state) inside html nodes or at attribute level
*  Type definitions for component props (PropTypes in React, props in Vue)
*  External dependencies definition
*  Simple component state (Hooks in React)
*  Event Handlers (related to state changes)
*  Repeat structures (.map in React, v-for in Vue)

### Project Generators

We have **official** project generators for the two different frameworks we're supporting so far. For `React`, we can generate a project based on a `React` and `React-Router` template, or we can generate a project on top of `Next.js`. For `Vue`, we have a standard `Vue` app, build with the `vue-cli` and a generator for `Nuxt`.

Project generators rely on the component generators and on the structure of the `ProjectUIDL` to figure out how many files to create and where to create them. Each project generator has its own strategy, based on the particularities of that specific framework/tool.

#### React + React-Router

Coming soon

#### Next

Coming soon

#### Vue

Coming soon

#### Nuxt

Coming soon

#### Advanced Capabilities
Besides the regular files and folders generated at the end of the process, project generators are also taking care of:
* Extracting all external dependencies and adding them to the `package.json`
* Creating the entry point for each application (it can be an `index.html` or something that is framework specific)
* Generating a web manifest for PWA support

Full documentation coming soon.

### Further Reading
A few useful links to get you up to speed with the entire **teleport** ecosystem:
* [Component](link coming soon) and [Project](link coming soon) JSON Schemas
* [Full Documentation](link coming soon)
* [Introducing the new Generators](link coming soon)
* [Playground link](link coming soon)

<h2 id="development">💻 Development</h2>

This project is writen with **TypeScript** and has a pretty standard setup. In order to give it a spin locally, you have to:

```
npm install
```

Project generators are running locally in the `/examples` folder, where you'll find a number of UIDL samples as well as the code that writes the files and folders to disk.

To generate the projects locally, you can try one of these four examples:
```
npm run create-react-basic
npm run create-react-next
npm run create-vue-basic
npm run create-vue-nuxt
```

Files and folders for each template are generated after you run the corresponding npm task in `/examples/projects-exporters/<project-template>`.

Running the test suite:
```
npm run test
npm run test:coverage
```

Please [open an issue](https://github.com/teleporthq/teleport-code-generators/issues) for any irregularity, potential bug that you find while running the codebase, or if you simply have any questions or curiosities about this project.

<h2 id="planning">🤖 Planning</h2>

It's not just our code that's open source, we're also planning the development of the code generators on GitHub. We already have [a number of issues](https://github.com/teleporthq/teleport-code-generators/issues) opened and we expect further contributions on this.

We're especially interested in opening discussions around the issues tagged with the [`proposal`](https://github.com/teleporthq/teleport-code-generators/issues?q=is%3Aissue+is%3Aopen+label%3Aproposal) label.

We also have a couple of milestone down the line:

### Beta Release 0.7
We plan on releasing this around mid May 2019. Most of the issues tackled during this milestone [can be found here](https://github.com/teleporthq/teleport-code-generators/milestone/4).

### Official Release
Our official release will be a switch to version `1.0`. ETA for this is around mid June/July 2019. Hopefully, by then, we'll have more people contributing to the code generators.

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
<table><tr><td align="center"><a href="https://medium.com/@alexnm"><img src="https://avatars0.githubusercontent.com/u/9945366?v=4" width="100px;" alt="Alex Moldovan"/><br /><sub><b>Alex Moldovan</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=alexnm" title="Code">💻</a> <a href="https://github.com/teleporthq/teleport-code-generators/commits?author=alexnm" title="Documentation">📖</a> <a href="#ideas-alexnm" title="Ideas, Planning, & Feedback">🤔</a></td><td align="center"><a href="https://github.com/vladnicula"><img src="https://avatars3.githubusercontent.com/u/126038?v=4" width="100px;" alt="Vlad Nicula"/><br /><sub><b>Vlad Nicula</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=vladnicula" title="Code">💻</a> <a href="#ideas-vladnicula" title="Ideas, Planning, & Feedback">🤔</a></td><td align="center"><a href="https://github.com/paulbrie"><img src="https://avatars2.githubusercontent.com/u/3997538?v=4" width="100px;" alt="Paul BRIE"/><br /><sub><b>Paul BRIE</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/issues?q=author%3Apaulbrie" title="Bug reports">🐛</a> <a href="https://github.com/teleporthq/teleport-code-generators/commits?author=paulbrie" title="Documentation">📖</a> <a href="#ideas-paulbrie" title="Ideas, Planning, & Feedback">🤔</a></td><td align="center"><a href="https://github.com/mihaitaba"><img src="https://avatars3.githubusercontent.com/u/45386599?v=4" width="100px;" alt="mihaitaba"/><br /><sub><b>mihaitaba</b></sub></a><br /><a href="#design-mihaitaba" title="Design">🎨</a> <a href="https://github.com/teleporthq/teleport-code-generators/commits?author=mihaitaba" title="Documentation">📖</a></td><td align="center"><a href="https://github.com/mihaiserban"><img src="https://avatars2.githubusercontent.com/u/3420526?v=4" width="100px;" alt="Mihai Serban"/><br /><sub><b>Mihai Serban</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=mihaiserban" title="Code">💻</a></td><td align="center"><a href="https://twitter.com/askjkrishna"><img src="https://avatars0.githubusercontent.com/u/11075561?v=4" width="100px;" alt="Jaya Krishna Namburu"/><br /><sub><b>Jaya Krishna Namburu</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=JayaKrishnaNamburu" title="Code">💻</a> <a href="https://github.com/teleporthq/teleport-code-generators/issues?q=author%3AJayaKrishnaNamburu" title="Bug reports">🐛</a></td><td align="center"><a href="https://github.com/anamariaoros"><img src="https://avatars0.githubusercontent.com/u/17590608?v=4" width="100px;" alt="Anamaria Oros"/><br /><sub><b>Anamaria Oros</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=anamariaoros" title="Code">💻</a></td></tr><tr><td align="center"><a href="https://github.com/ovidiuionut94"><img src="https://avatars3.githubusercontent.com/u/11486739?v=4" width="100px;" alt="ovidiuionut94"/><br /><sub><b>ovidiuionut94</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=ovidiuionut94" title="Code">💻</a></td><td align="center"><a href="https://github.com/alexpausan"><img src="https://avatars0.githubusercontent.com/u/3284064?v=4" width="100px;" alt="alexpausan"/><br /><sub><b>alexpausan</b></sub></a><br /><a href="https://github.com/teleporthq/teleport-code-generators/commits?author=alexpausan" title="Code">💻</a></td></tr></table>

<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind welcome!

<h2 id="contact">✍️ Contact</h2>

Reach out to us on any of these channels:
* 📧 [Write an Email](mailto:hello@teleporthq.io)
* 🐦 [Drop a message on twitter](https://twitter.com/teleporthqio)
* ℹ️ [Website](https://teleporthq.io/)
