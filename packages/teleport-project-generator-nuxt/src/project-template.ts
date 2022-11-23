export default {
  name: 'teleport-project-nuxt',
  files: [
    {
      content: `
{
  "name": "teleport-project-nuxt",
  "version": "1.0.0",
  "description": "A nuxt project generated based on a UIDL document",
  "author": "teleporthq.io",
  "private": true,
  "scripts": {
    "dev": "nuxt",
    "build": "nuxt build",
    "start": "nuxt start",
    "generate": "nuxt generate"
  },
  "devDependencies": {
    "nuxt": "^2.15.8"
  }
}`,
      fileType: 'json',
      name: 'package',
    },
    {
      content: `
plugins: [
  "~/plugins/lottie-vue-player.client.js"
]`,
      fileType: 'js',
      name: 'nuxt.config',
    },
  ],
  subFolders: [
    {
      name: 'layouts',
      files: [
        {
          name: 'default',
          content: `
<template>
  <div><nuxt /></div>
</template>`,
          fileType: 'vue',
        },
      ],
      subFolders: [],
    },
    {
      name: 'plugins',
      files: [
        {
          name: 'lottie-vue-player.client.js',
          content: `
import Vue from 'vue';

import LottieVuePlayer from "@lottiefiles/vue-lottie-player";

Vue.use(LottieVuePlayer);
          `,
        },
      ],
      subFolders: [],
    },
  ],
}
