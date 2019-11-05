export default {
  name: 'teleport-slides-react',
  files: [
    {
      name: 'index',
      fileType: 'html',
      content: `
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="utf-8" />
  <title>Slides Template</title>
  <style>
    html {
      height: 100%;
    }
    body {
      margin: 0px;
      height: 100%;
      width: 100%;
    }
  </style>
</head>

<body>
  <div id="app" style="
    display: flex;
    align-items: center;
    overflow: hidden;
    justify-content: center;
    width: 100%;
    height: 100%;"></div>
  <script src="./src/index.js" type="text/javascript"></script>
</body>

</html>
`,
    },
    {
      name: '.babelrc',
      content: `
{
  "presets": [
    "env",
    "react"
  ]
}
`,
    },
    {
      name: '.gitignore',
      content: `
node_modules/
dist/
.cache/
yarn-error.log
`,
    },
    {
      name: '.postcssrc',
      content: `
{
  "modules": true
}
`,
    },
    {
      name: 'package',
      content: `
      {
        "name": "teleport-slides-template",
        "version": "0.0.0",
        "description": "A template for exporting components as slides",
        "main": "index.js",
        "license": "MIT",
        "devDependencies": {
          "babel-core": "^6.26.3",
          "babel-preset-env": "^1.7.0",
          "babel-preset-react": "^6.24.1",
          "parcel": "^1.12.4",
          "postcss-modules": "^1.4.1"
        },
        "dependencies": {
          "react": "^16.11.0",
          "react-dom": "^16.11.0"
        },
        "scripts": {
          "start": "yarn parcel index.html"
        }
      }`,
      fileType: 'json',
    },
  ],
  subFolders: [
    {
      name: 'src',
      files: [
        {
          name: 'index',
          fileType: 'js',
          content: `
import React, { useState, useEffect, Fragment } from 'react'
import ReactDOM from 'react-dom'
import * as files from './slides'
import styles from './styles.module.css'

const slides = Object.keys(files)

const RenderSlide = ({ component }) => component()

const App = () => {
  const [slide, setSlide] = useState(1)
  const progress = (slide/slides.length)*100

  const handleKeyDown = (e) => {
    const UP = Boolean(e.key === 'ArrowRight' || e.key === 'PageUp')
    const DOWN = Boolean(e.key === 'ArrowLeft' || e.key === 'PageDown')
    if (UP && slide < slides.length ) {
      e.preventDefault();
      setSlide(slide + 1)
    }
    
    if (DOWN && (slide > 1 && slide <= slides.length)) {
      e.preventDefault();
      setSlide(slide - 1)
    }
  }

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [slide])
  
  return (
    <Fragment>
      <RenderSlide component={files[slides[slide - 1]]}/>
      <div className={styles.slider}>
        <span className={styles.progress} style={{ width: ${String('`${progress}%`')}}}></span>
      </div>
    </Fragment>
  )
}

ReactDOM.render(<App />, document.getElementById('app'))
`,
        },
        {
          name: 'styles.module',
          fileType: 'css',
          content: `
.slider {
  width: inherit;
  height: 5px;
  background-color: #fff;
  position: fixed;
  bottom: 0
}

.progress {
  height: 5px;
  border-radius: 8px;
  position: absolute;
  background-color: greenyellow;
}

@keyframes slide {
  0% {
    widh: 0%;
  }
  100% {
    width: auto;
  }
}
`,
        },
      ],
      subFolders: [],
    },
  ],
}
