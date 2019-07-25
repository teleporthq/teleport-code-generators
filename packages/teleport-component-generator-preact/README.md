# teleport-component-generator-preact

Component generator customization, capable of creating Preact components with CSS-Modules styling

> This package is part of the [teleport ecosystem](https://github.com/teleporthq/teleport-code-generators). For a complete guide, check out the [official documentation](https://docs.teleporthq.io/).

## Install
```bash
npm install @teleporthq/teleport-component-generator-preact
```
or
```bash
yarn add @teleporthq/teleport-component-generator-preact
```

## Usage
```javascript
import { createPreactComponentGenerator } from '@teleporthq/teleport-component-generator-preact'

const preactGenerator = createPreactComponentGenerator(')

const result = await preactGenerator.generateComponent(uidl)
```

