# teleport-component-generator

Bare-bone component generator on top of which you can add plugins, mappings and post processing functions.

> This package is part of the [teleport ecosystem](https://github.com/teleporthq/teleport-code-generators). For a complete guide, check out the [official documentation](https://docs.teleporthq.io/).

## Install
```bash
npm install @teleporthq/teleport-component-generator
```
or
```bash
yarn add @teleporthq/teleport-component-generator
```

## Usage
```javascript
import generator from '@teleporthq/teleport-component-generator'

generator.addMapping({ /*...*/ }) // Add a mapping object for UIDL element types

generator.addPlugin(plugin1) // Add the plugins in the order in which they will be called
generator.addPlugin(plugin2)
/* ... */

generator.addPostProcessor(prettierJS) // Add any number of post-processor functions
generator.addPostProcessor(/* ... */)

const result = await generator.generateComponent(uidl)
```

