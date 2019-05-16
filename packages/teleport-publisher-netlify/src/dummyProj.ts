export const DUMMY_PROJECT = {
  name: 'dist-hehe-hehe',
  files: [
    {
      name: 'package',
      fileType: 'json',
      content:
        '{\n  "name": "myvueproject",\n  "version": "1.0.0",\n  "description": "A next project generated based on a UIDL document",\n  "main": "index.js",\n  "scripts": {\n    "dev": "next",\n    "build": "next build",\n    "start": "next start"\n, "export": "npm run build && next export"\n  },\n  "author": "TeleportHQ",\n  "license": "MIT",\n  "dependencies": {\n    "next": "^8.0.3",\n    "react": "16.8.4",\n    "react-dom": "16.8.4"\n  }\n}',
    },
    {
      name: 'netlify',
      fileType: 'toml',
      content: '[build]\n command = "npm run export"\n publish = "out"\n',
    },
  ],
  subFolders: [
    {
      name: 'pages',
      files: [
        {
          name: '_document',
          fileType: 'js',
          content:
            'import Document, { Head, Main, NextScript } from \'next/document\'\n\nclass CustomDocument extends Document {\n  render() {\n    return (\n      <html lang="en">\n        <Head>\n          <title>UIDL v0.6 Project</title>\n        </Head>\n        <body>\n          <Main />\n          <NextScript />\n        </body>\n      </html>\n    )\n  }\n}\n\nexport default CustomDocument\n',
        },
        {
          name: 'index',
          fileType: 'js',
          content:
            "import React from 'react'\n\nimport Navbar from '../components/Navbar'\n\nconst Home = (props) => {\n  return (\n    <div className=\"container\">\n      <Navbar />\n      Page 1\n      <style jsx>\n        {`\n          .container {\n            border: 1px solid green;\n            padding: 10px;\n          }\n        `}\n      </style>\n    </div>\n  )\n}\n\nexport default Home\n",
        },
        {
          name: 'about',
          fileType: 'js',
          content:
            "import React from 'react'\n\nimport Navbar from '../components/Navbar'\n\nconst About = (props) => {\n  return (\n    <div className=\"container\">\n      <Navbar />\n      Page 2\n      <style jsx>\n        {`\n          .container {\n            border: 1px solid black;\n            padding: 1px solid black;\n          }\n        `}\n      </style>\n    </div>\n  )\n}\n\nexport default About\n",
        },
      ],
      subFolders: [],
    },
    {
      name: 'components',
      files: [
        {
          name: 'Navbar',
          fileType: 'js',
          content:
            'import React, { Fragment } from \'react\'\nimport Link from \'next/link\'\n\nconst Navbar = (props) => {\n  return (\n    <Fragment>\n      <Link href="/">\n        <a>Home</a>\n      </Link>\n      <Link href="/about">\n        <a>About</a>\n      </Link>\n      <Link href="/here-we-are">\n        <a>Contact</a>\n      </Link>\n    </Fragment>\n  )\n}\n\nexport default Navbar\n',
        },
        {
          name: 'NewUIDL',
          fileType: 'js',
          content:
            "import React, { useState } from 'react'\nimport Link from 'next/link'\nimport PropTypes from 'prop-types'\n\nconst NewUIDL = (props) => {\n  const [isVisible, setIsVisible] = useState(true)\n  return (\n    <div data-static-attr=\"test\" data-dynamic-attr={props.title}>\n      <span>\n        Hello World!\n        {props.title}\n      </span>\n      {props.items.map((item, index) => (\n        <span key={index}>\n          {item}\n          <ul>\n            {['angular', 'react', 'vue'].map((item, index) => (\n              <li key={index}>{item}</li>\n            ))}\n          </ul>\n        </span>\n      ))}\n      {props.title === 'matching' && <span>Now you see me!</span>}\n      <video autoPlay>\n        <source src=\"https://www.quirksmode.org/html5/videos/big_buck_bunny.mp4\" type=\"video/mp4\" />\n        This browser does not support the video formats given\n      </video>\n      {props.children}\n      <Link href=\"about\">\n        <a>About Page</a>\n      </Link>\n    </div>\n  )\n}\n\nNewUIDL.defaultProps = {\n  title: 'Hello',\n  items: [],\n}\n\nNewUIDL.propTypes = {\n  title: PropTypes.string,\n  items: PropTypes.array,\n}\n\nexport default NewUIDL\n",
        },
        {
          name: 'ExpandableArea',
          fileType: 'js',
          content:
            "import React, { useState } from 'react'\nimport PropTypes from 'prop-types'\n\nconst ExpandableArea = (props) => {\n  const [isExpanded, setIsExpanded] = useState(false)\n  return (\n    <div className=\"container\">\n      <span>{props.title}</span>\n      <button onClick={() => setIsExpanded(!isExpanded)}>\n        {isExpanded && 'Hide me'}\n        {!isExpanded && 'Show me'}\n      </button>\n      {isExpanded && <span>{props.text}</span>}\n      <style jsx>\n        {`\n          .container {\n            border: 1px solid green;\n            margin: 10px;\n          }\n        `}\n      </style>\n    </div>\n  )\n}\n\nExpandableArea.defaultProps = {\n  title: 'Hello',\n  text: \"Is it me you're looking for?\",\n}\n\nExpandableArea.propTypes = {\n  title: PropTypes.string,\n  text: PropTypes.string,\n}\n\nexport default ExpandableArea\n",
        },
        {
          name: 'Modal',
          fileType: 'js',
          content:
            "import React, { useState, Fragment } from 'react'\n\nimport ModalWindow from './ModalWindow'\n\nconst Modal = (props) => {\n  const [isOpen, setIsOpen] = useState(false)\n  return (\n    <Fragment>\n      <button onClick={() => setIsOpen(true)}>Show Popup</button>\n      {isOpen && <ModalWindow onClose={() => setIsOpen(false)} />}\n    </Fragment>\n  )\n}\n\nexport default Modal\n",
        },
        {
          name: 'ModalWindow',
          fileType: 'js',
          content:
            "import React, { useState } from 'react'\nimport PropTypes from 'prop-types'\n\nconst ModalWindow = (props) => {\n  const [fakeState, setFakeState] = useState(false)\n  return (\n    <div>\n      {props.message}\n      <button\n        onClick={() => {\n          props.onClose()\n          setFakeState(false)\n        }}\n      >\n        Close me\n      </button>\n    </div>\n  )\n}\n\nModalWindow.defaultProps = {\n  message: 'Hello',\n  onClose: '() => {}',\n}\n\nModalWindow.propTypes = {\n  message: PropTypes.string,\n  onClose: PropTypes.func,\n}\n\nexport default ModalWindow\n",
        },
      ],
      subFolders: [],
    },
    { name: 'static', files: [], subFolders: [] },
  ],
}
