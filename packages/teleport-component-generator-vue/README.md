# teleport-component-generator-vue

Component generator customization, capable of creating Vue components.

> This package is part of the [teleport ecosystem](https://github.com/teleporthq/teleport-code-generators). For a complete guide, check out the [official documentation](https://docs.teleporthq.io/).

## Install
```bash
npm install @teleporthq/teleport-component-generator-vue
```
or
```bash
yarn add @teleporthq/teleport-component-generator-vue
```

## Usage
```javascript
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'

const vueGenerator = createVueComponentGenerator()

const result = await vueGenerator.generateComponent(uidl)
```

