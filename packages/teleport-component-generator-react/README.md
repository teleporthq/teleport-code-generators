# teleport-component-generator-react

Component generator customization, capable of creating React components with a number of different style flavors.

> This package is part of the [teleport ecosystem](https://github.com/teleporthq/teleport-code-generators). For a complete guide, check out the [official documentation](https://docs.teleporthq.io/).

## Install
```bash
npm install @teleporthq/teleport-component-generator-react
```
or
```bash
yarn add @teleporthq/teleport-component-generator-react
```

## Usage
```javascript
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'

// other style options: "InlineStyles" - default, "StyledComponents", "StyledJSX", "JSS"
const reactGenerator = createReactComponentGenerator('CSSModules')

const result = await reactGenerator.generateComponent(uidl)
```

