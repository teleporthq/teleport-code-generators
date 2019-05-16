export const DEPLOY_URL = 'https://api.zeit.co/v6/now/deployments'

export const NEXT_CONFIG_FILE = {
  file: 'next.config.js',
  data: 'module.exports = { target: "serverless" }',
}

export const NEXT_CONFIG = {
  version: 2,
  env: {
    NODE_ENV: 'production',
  },
  builds: [{ src: 'next.config.js', use: '@now/next' }, { src: 'static/*', use: '@now/static' }],
  public: true,
}

export const NOW_LINK_PREFIX = 'https://'
