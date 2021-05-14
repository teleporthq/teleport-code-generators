export const DEFAULT_THEME_CONSTANTS = {
  primaryColor: '#0089be',
  backgroundColor: '#fff',
  borderRadius: '4px',
  borderWidth: '1px',
  fontSize: '16px',
  color: '#2b2b2b',
  lineHeight: '1.55',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen","Ubuntu", "Cantarell", "Fira Sans","Droid Sans", "Helvetica Neue", sans-serif',
  fontStyle: 'normal',
  letterSpacing: 'normal',
}

export const getProjectGlobalStylesheet = (
  stylesFromTokens: Record<string, string>,
  targetStage?: boolean
) => {
  return `
    body {
      font-family: ${stylesFromTokens?.fontFamily ?? DEFAULT_THEME_CONSTANTS.fontFamily};
      font-size: ${stylesFromTokens?.fontSize ?? DEFAULT_THEME_CONSTANTS.fontSize};
      font-weight: ${stylesFromTokens?.fontWeight};
      font-style:${stylesFromTokens?.fontStyle ?? DEFAULT_THEME_CONSTANTS.fontStyle};
      text-decoration: ${stylesFromTokens?.textDecoration};
      text-transform: ${stylesFromTokens?.textTransform};
      letter-spacing: ${stylesFromTokens?.letterSpacing ?? DEFAULT_THEME_CONSTANTS.letterSpacing};
      color: ${stylesFromTokens.color ?? DEFAULT_THEME_CONSTANTS.color};
      background-color: ${stylesFromTokens.background ?? DEFAULT_THEME_CONSTANTS.backgroundColor};
      line-height: ${stylesFromTokens.lineHeight ?? DEFAULT_THEME_CONSTANTS.lineHeight};
      ${targetStage ? `user-select: none;` : ''}
    }
  
    ${targetStage ? `*:focus { \n outline: none; \n }` : ``}
  `
}

export const getResetStylesheet = () => `
html {
  line-height: 1.15;
}
body {
  margin: 0;
}

* {
  box-sizing: border-box;
  border-width: 0;
  border-style: solid;
}

p,
li,
ul,
pre,
div,
h1,
h2,
h3,
h4,
h5,
h6 {
  margin: 0;
  padding: 0;
}

button,
input,
optgroup,
select,
textarea {
  font-family: inherit;
  font-size: 100%;
  line-height: 1.15;
  margin: 0;
}

button,
select {
  text-transform: none;
}

button,
[type="button"],
[type="reset"],
[type="submit"] {
  -webkit-appearance: button;
}

button::-moz-focus-inner,
[type="button"]::-moz-focus-inner,
[type="reset"]::-moz-focus-inner,
[type="submit"]::-moz-focus-inner {
  border-style: none;
  padding: 0;
}

button:-moz-focus,
[type="button"]:-moz-focus,
[type="reset"]:-moz-focus,
[type="submit"]:-moz-focus {
  outline: 1px dotted ButtonText;
}

a {
  color: inherit;
  text-decoration: inherit;
}

input {
  padding: 2px 4px;
}

img {
  display: block;
}
`
