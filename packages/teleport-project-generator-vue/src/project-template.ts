export default {
  name: 'teleport-project-vue',
  files: [
    {
      name: 'package',
      content: `
{
  "name": "teleport-project-vue",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "serve": "vue-cli-service serve",
    "build": "vue-cli-service build"
  },
  "dependencies": {
    "vue": "^2.6.7",
    "vue-router": "^3.0.2",
    "vue-meta": "^2.2.1"
  },
  "devDependencies": {
    "@vue/cli-plugin-babel": "^3.4.1",
    "@vue/cli-service": "^3.4.1",
    "vue-template-compiler": "^2.6.7"
  },
  "postcss": {
    "plugins": {
      "autoprefixer": {}
    }
  },
  "browserslist": [
    "> 1%",
    "last 2 versions",
    "not ie <= 8"
  ]
}`,
      fileType: 'json',
    },
    {
      name: 'babel.config',
      content: `
module.exports = {
  presets: [
    '@vue/app'
  ]
}`,
      fileType: 'js',
    },
  ],
  subFolders: [
    {
      name: 'src',
      files: [
        {
          name: 'App',
          content: `
<template>
  <router-view/>
</template>`,
          fileType: 'vue',
        },
        {
          name: 'main',
          content: `
import Vue from 'vue'
import App from './App.vue'
import router from './router'

Vue.config.productionTip = false

new Vue({
  render: h => h(App),
  router
}).$mount('#app')`,
          fileType: 'js',
        },
      ],
      subFolders: [],
    },
  ],
}
