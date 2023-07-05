import { FileType, GeneratedFolder } from '@teleporthq/teleport-types'

const projectTemplate: GeneratedFolder = {
  name: 'teleport-project-next',
  files: [
    {
      name: 'next.config',
      fileType: FileType.JS,
      content: `module.exports = () => {
const nextConfig = {
    webpack(config) {
        config.resolve.alias = {
            ...config.resolve.alias,
            'components/cms-list': require.resolve('./components/cms-list.js'),
            'components/cms-item': require.resolve('./components/cms-item.js')
        }
        return config
    }
}
return nextConfig
}`,
    },
    {
      name: 'package',
      content: `
{
  "name": "teleport-project-next",
  "version": "1.0.0",
  "description": "A next project generated based on a UIDL document",
  "main": "index.js",
  "scripts": {
    "dev": "next",
    "build": "next build",
    "start": "next start",
    "export": "next export"
  },
  "author": "TeleportHQ",
  "license": "MIT",
  "dependencies": {
    "next": "^12.1.0",
    "react": "^17.0.2",
    "react-dom": "^17.0.2"
  }
}`,
      fileType: 'json',
    },
  ],
  subFolders: [
    {
      name: 'components',
      subFolders: [],
      files: [
        {
          name: 'cms-item',
          fileType: FileType.JS,
          content: `import React from "react";
const Repeater = (props) => {
  const { items, renderItem, renderEmpty } = props;
  if (items.length === 0) {
    return renderEmpty();
  } else {
    return /*#__PURE__*/ React.createElement(
      React.Fragment,
      null,
      items.map((item, index) => renderItem(item, index))
    );
  }
};
export default Repeater;
`,
        },
        {
          name: 'cms-list',
          fileType: FileType.JS,
          content: `import { useState, useEffect, useRef } from "react";
const DataProvider = (props) => {
  const {
    fetchData,
    params,
    initialData,
    persistDataDuringLoading = false,
    renderLoading,
    renderSuccess,
    renderError
  } = props;
  const [status, setStatus] = useState("idle");
  const [data, setData] = useState(initialData);
  const [error, setError] = useState(null);
  const passFetchBecauseWeHaveInitialData = useRef(
    props.initialData !== undefined
  );
  const persistDataDuringLoadingRef = useRef(persistDataDuringLoading);
  persistDataDuringLoadingRef.current = persistDataDuringLoading;
  useEffect(() => {
    if (passFetchBecauseWeHaveInitialData.current) {
      passFetchBecauseWeHaveInitialData.current = false;
      return;
    }
    const fetchDataAsync = async () => {
      setStatus("loading");
      if (!persistDataDuringLoadingRef.current) {
        setData(undefined);
      }
      try {
        const result = await fetchData(params);
        setData(result);
        setStatus("success");
      } catch (err) {
        setError(err);
        setStatus("error");
      }
    };
    fetchDataAsync();
  }, [params, fetchData]);
  switch (status) {
    case "idle":
    case "loading":
      return props.persistDataDuringLoading && data
        ? renderSuccess(data, true)
        : renderLoading
        ? renderLoading()
        : null;
    case "success":
      return renderSuccess(data, false);
    case "error":
      return renderError(error);
    default:
      return null;
  }
};
export default DataProvider;
`,
        },
      ],
    },
  ],
}

export default projectTemplate
