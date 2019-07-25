# teleport-component-generator-stencil

Component generator customization, capable of creating Stencil components

> This package is part of the [teleport ecosystem](https://github.com/teleporthq/teleport-code-generators). For a complete guide, check out the [official documentation](https://docs.teleporthq.io/).

## Install
```bash
npm install @teleporthq/teleport-component-generator-stencil
```
or
```bash
yarn add @teleporthq/teleport-component-generator-stencil
```

## Usage
```javascript
import { createStencilComponentGenerator } from '@teleporthq/teleport-component-generator-stencil'

const stencilGenerator = createStencilComponentGenerator(')

const result = await stencilGenerator.generateComponent(uidl)
```

