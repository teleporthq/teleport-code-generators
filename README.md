<p align="center">
    <img src="https://raw.githubusercontent.com/teleporthq/teleport-lib-js/master/logo50.png" width="250"/>
</p>

<h2 align="center">Code Generators v0.3 - Alpha!</h2>

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
  <img src="https://img.shields.io/npm/v/@teleporthq/teleport-code-generators.svg" />
  <img src="https://travis-ci.org/teleporthq/teleport-code-generators.svg?branch=master" />
  <img src="https://codecov.io/gh/teleporthq/teleport-code-generators/branch/master/graph/badge.svg" />
  <img src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg" />
  <img src="https://img.shields.io/npm/l/@teleporthq/teleport-code-generators.svg" />
  <img src="https://img.shields.io/bundlephobia/minzip/@teleporthq/teleport-code-generators.svg" />
  <img src="https://img.shields.io/twitter/follow/teleporthqio.svg" />
</p>

This is a **WIP prototype** containing all our project and component generators, as well as the **UIDL** schemas and validators. While we have some working examples, it should not be considered production ready by any means! Do not hesitate to give us feedback and contribute back!

<h2 id="what">🤔 What is this?</h2>

The **code generators** are a part of the **teleportHQ** ecosystem, which we are actively building, in an effort to streamline web and mobile applications creation. You can read more about our inception in [this article](https://teleporthq.io/blog/we-believe-in-AI-powered-code-generation/).

The code generators are used by our online **visual editor** (coming soon), a platform which lets you build applications via a familiar design tool interface. The glue between our platform and the code generators is the [**UIDL Standard**](link coming soon). The UIDL allows us to define **user interfaces** in an **abstract** way, independent of any framework or even the web platform itself, which then allows us to convert that abstraction into different flavors of coding (ex: React, Vue, etc.)

Our philosophy behind the code generators is:
* User interfaces are decomposed into **components**, hence our focus on component generation
* What can be built with `React`, can also be built with `Vue` or on top of the `Web Components` standard, we support multiple targets
* A project built with the visual editor should have a **high standard of quality** (performance, security, accessibility included)
* Generated **code quality** should be as good as possible, so that any developer can pick up the work from there and enhance the project
* The code generation architecture is open and extendable, we invite everyone to contribute!

You can also read more about our [decision to open source our code generators](link coming soon).

Read more about the [UIDL Standard](link coming soon).

<h2 id="quick-setup">🚀 Quick Setup</h2>

While this will probably remain a [monorepo](https://danluu.com/monorepo/), we will publish different **npm** packages for various parts of our code generation ecosystem. For now, there's a single package published under `@teleporthq/teleport-generators`. So, let's integrate that into your project:

```bash
npm install @teleporthq/teleport-code-generators
```

```javascript
import { createReactComponentGenerator } from "teleport-generators"

const reactGenerator = createReactComponentGenerator()

const componentUIDL = {
    "name": "MyComponent",
    "content": {
        "type": "text",
        "key": "text",
        "children": ["Teleport World!"]
    }
}

const result = reactGenerator.generateComponent(componentUIDL)
```

The code output from this snippet would be
```jsx
import React from "react"

const MyComponent = props => {
  return <span>Teleport World!</span>
}

export default MyComponent
```

<h2 id="features">💼 Features</h2>

This repo contains multiple **modules** which will soon be available as individual `npm` **packages**. There are two types of generators available: component and project generators. Component generators take a simple **ComponentUIDL** input and return the **code** according to the specific generator flavors (ex: React + StyledJSX, Vue, etc). Project generators operate on **ProjectUIDL**s and will return a complete structure of `folders` and `files` which then can be written to disk or sent to servers for deployment. The aim of the project generators is to output a **working application**.

### Component Generators

We have **official** component generators for `React` and `Vue`, but we plan on supporting other frameworks and standards as soon as possible. Also, `React Native` is definitely on our minds, because we designed the UIDL in such a way that it is agnostic of the web platform.

There are two **factory functions** exported from our main module, for the React and Vue generators.

#### React

```javascript
import { createReactComponentGenerator } from "teleport-generators"

// Instantiate a generator, selecting the styled-jsx plugin for handling styles (other options: CSSModules, JSS, InlineStyles)
const reactGenerator = createReactComponentGenerator({ variation: "StyledJSX" })

// Calling the generate function will return the code as a string
const result = reactGenerator.generateComponent(uidl)

console.log(result.code)
```

Read more about [the API of the component generator](link coming soon).

Read more about [mappings and resolvers](link coming soon).

#### Vue

```javascript
import { createVueComponentGenerator } from "teleport-generators"

// Instantiate a vue generator
const vueGenerator = createVueComponentGenerator()

// Calling the generate function will return the code as a string
const result = vueGenerator.generateComponent(uidl)

console.log(result.code)
```

#### Advanced capabilities
Here's a list of functionalities that the UIDL and the component generators support at the moment, besides the obvious presentational layer:
*  Dynamic values (props, state) inside html nodes or at attribute level
*  Type definitions for component props (PropTypes in React, props in Vue)
*  External dependencies definition
*  Simple component state (Hooks in React)
*  Event Handlers (related to state changes)
*  Repeat structures (.map in React, v-for in Vue)

### Project Generators

We have **official** project generators for the two different frameworks we support so far. For `React`, we can generate a project based on a `React` and `React-Router` template, or we can generate a project on top of `Next.js`. For `Vue`, we have a standard `Vue` app, build with the `vue-cli` and a generator for `Nuxt`.

Project generators rely on the component generators and on the structure of the `ProjectUIDL` to figure out how many files to create and where. Each project generator has its own strategy, based on the particularities of that specific framework/tool.

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
* Creating the entry point for each application (it can be an `index.html` or something framework specific)
* Generating a web manifest for PWA support

### UIDL Validators

The package also exports a module that performs UIDL validations for any given JSON structure, based on the [JSON Schema](link coming soon).

```javascript
import { UIDLValidators } from "@teleporthq/teleport-generators"

const componentUIDL = { ... }
const projectUIDL = { ... }

UIDLValidators.validateComponent(componentUIDL) // true / error object
UIDLValidators.validateProject(projectUIDL) // true / error object
```

When the validation fails, an **error** object is returned. Validation is performed using [https://github.com/epoberezkin/ajv](a standard JSON schema validator).

### Further Reading
A few useful links to get you up to speed with the entire **teleport** ecosystem:
* [Component](link coming soon) and [Project](link coming soon) JSON Schemas
* [Full Documentation](link coming soon)
* [Introducing the new Generators](link coming soon)
* [Playground link](link coming soon)

<h2 id="development">💻 Development</h2>

This project is writen with **TypeScript**. The project setup is pretty standard. In order to give it a spin locally, you have to do:

```
npm install
```

Project generators are running locally in the `/examples` folder, where you will find a number of UIDL samples as well as the code that write the files and folders to disk.

To generate the projects locally, you can try one of the four examples:
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

Please [open an issue](https://github.com/teleporthq/teleport-code-generators/issues) for any irregularity or potential bug that you see while running the codebase, or simply if you have any question or curiosity about this project.

<h2 id="planning">🤖 Planning</h2>

Not only our code is open source, but we are also planning the development of the code generators on GitHub. We already have [a number of issues](https://github.com/teleporthq/teleport-code-generators/issues) open, and we expect further contributions on this.

We are especially interesting in opening the discussions around the issues tagged with the [`proposal`](https://github.com/teleporthq/teleport-code-generators/issues?q=is%3Aissue+is%3Aopen+label%3Aproposal) label.

We also have a couple of milestone down the line:

### Beta Release
This is our immediately planned release for both the teleportHQ platform, as well as for the new website and generators. ETA for this release is mid April 2019, but this also depends on the release of the other parts of the ecosystem.

### Official Release
Our official release will be the switch to version `1.0`. ETA for this is around May/June 2019. Hopefully, by then, we will have more people contributing to the code generators.

<h2 id="contributions">💕 Contributions</h2>

We would be super happy to have **community** involvement around this project. We strongly believe in the power of **open source**, so we want to build the best possible code generators together with the entire development community.

We envision different types of involvement from this point on:
* Trying out the generators and reporting back bugs and potential points of improvement
* Contributing to the existing issues, either on the core modules or on the existing generators and plugins
* Exploring and building new plugins for the existing generators
* Exploring and building new generators based on the existing architecture

<h2 id="contact">✍️ Contact</h2>

Reach out to us on any channel:
* 📧 [Write an Email](mailto:hello@teleporthq.io)
* 🐦 [Drop a message on twitter](https://twitter.com/teleporthqio)
* ℹ️ [Website](https://teleporthq.io/)


