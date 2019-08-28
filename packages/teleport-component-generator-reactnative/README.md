# teleport-component-generator-reactnative

Component generator customization, capable of creating React Native components.

> This package is part of the [teleport ecosystem](https://github.com/teleporthq/teleport-code-generators). For a complete guide, check out the [official documentation](https://docs.teleporthq.io/).

## Install
```bash
npm install @teleporthq/teleport-component-generator-reactnative
```
or
```bash
yarn add @teleporthq/teleport-component-generator-reactnative
```

## Usage
```javascript
import { createReactNativeComponentGenerator } from '@teleporthq/teleport-component-generator-reactnative'

const reactNativeGenerator = createReactNativeComponentGenerator()

const result = await reactNativeGenerator.generateComponent(uidl)
```

