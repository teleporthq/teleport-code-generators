# teleport-component-generator-html

Component generator customization, capable of creating Stencil components

> This package is part of the [teleport ecosystem](https://github.com/teleporthq/teleport-code-generators). For a complete guide, check out the [official documentation](https://docs.teleporthq.io/).

## Install
```bash
npm install @teleporthq/teleport-component-generator-html
```
or
```bash
yarn add @teleporthq/teleport-component-generator-html
```

## Usage
```javascript
import { createHTMLComponentGenerator } from '@teleporthq/teleport-component-generator-html'

const htmlGenerator = createHTMLComponentGenerator(')

const result = await htmlGenerator.generateComponent(uidl)
```

