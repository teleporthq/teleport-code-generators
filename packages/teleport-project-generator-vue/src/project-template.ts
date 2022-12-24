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
    "vue-meta": "^2.2.1",
    "@lottiefiles/vue-lottie-player": "1.0.4"
  },
  "devDependencies": {
    "@vue/babel-preset-app": "^5.0.8",
    "@vue/cli-plugin-babel": "^5.0.4",
    "@vue/cli-service": "^5.0.8",
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
      name: 'vue.config',
      fileType: 'js',
      content: String.raw`const path = require('path')

module.exports = {
  css: {
    loaderOptions: {
      css: {
        url: false,
      },
    },
  },
  chainWebpack: config => {
    config.plugin('copy').tap(args => {
      const UNESCAPED_GLOB_SYMBOLS_RE = /(\\?)([()*?[\]{|}]|^!|[!+@](?=\())/g;
      const publicDir = path.resolve(process.VUE_CLI_SERVICE.context, 'public').replace(/\\/g, '/');
      const escapePublicDir= publicDir.replace(UNESCAPED_GLOB_SYMBOLS_RE, '\\$2');
      args[0].patterns[0].globOptions.ignore = args[0].patterns[0].globOptions.ignore.map(i => i.replace(publicDir, escapePublicDir));
      return args;
  });
  }
};`,
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
import LottieVuePlayer from '@lottiefiles/vue-lottie-player'

Vue.use(LottieVuePlayer)
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
