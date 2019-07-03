# teleport-component-repl

A webcomponent written in stencil that provides a REPL environment for the UIDL, converting the JSON format to React/Vue code.

> This package is part of the [teleport ecosystem](https://github.com/teleporthq/teleport-code-generators). For a complete guide, check out the [official documentation](https://docs.teleporthq.io/).

## Install
```bash
npm install @teleporthq/teleport-component-repl
```
or
```bash
yarn add @teleporthq/teleport-shared
```

## Usage

For integration in various frontend frameworks, check out the [stencil official documentation](https://stenciljs.com/docs/overview).

Once the web component is loaded, it can be used as a regular HTML tag

```html
<teleport-uidl-repl dark="false" uidl='...' />
```

