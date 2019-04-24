export const buildVueFile = (htmlCode, jsCode, cssCode) => {
  let code = `<template>
${htmlCode}
</template>

<script>
${jsCode}
</script>
`

  if (cssCode) {
    code += `
<style>
${cssCode}
</style>
`
  }

  return code
}
