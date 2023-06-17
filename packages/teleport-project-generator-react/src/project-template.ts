import { FileType, GeneratedFolder } from '@teleporthq/teleport-types'

const projectTemplate: GeneratedFolder = {
  name: 'teleport-project-react',
  files: [
    {
      name: 'package',
      content: `
{
  "name": "teleport-project-react",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "@craco/craco": "^7.0.0-alpha.0",
    "react": "^17.0.2",
    "react-dom": "^17.0.2",
    "react-router-dom": "^5.2.0"
  },
  "scripts": {
    "start": "craco start",
    "build": "craco build",
    "test": "craco test --env=jsdom",
    "eject": "craco eject"
  },
  "engines": {
    "node": "16.x"
  },
  "browserslist": {
    "production": [
      ">0.2%",
      "not dead",
      "not op_mini all"
    ],
    "development": [
      "last 1 chrome version",
      "last 1 firefox version",
      "last 1 safari version"
    ]
  },
  "devDependencies": {
    "react-scripts": "^5.0.1"
  }
}`,
      fileType: 'json',
    },
    {
      name: 'craco.config',
      fileType: 'js',
      content: `module.exports = {
  reactScriptsVersion: "react-scripts",
  style: {
    css: {
      loaderOptions: () => {
        return {
          url: false,
        };
      },
    },
  },
};`,
    },
  ],
  subFolders: [
    {
      name: 'src',
      files: [
        {
          name: 'cms-item',
          fileType: FileType.JS,
          content: `import { useEffect, useState, useRef } from "react";
/**
* - @param loading - JSX to display when the componet is in loading state.
* - @param error - JSX to display when the compnent hit a error state
* - @param children - Use for the renderProps patter to call the parent
* - @param fetcher - A promise from which we need to derive another three states, loading, error, data
* - @param params - Params that need to be passed while fetching the resource.
* - @param initialData - This is used to avoid the loading state, and fetch the new data when there is a change in the params
*/

const NO_INITIAL_DATA = Symbol(null);

export const CMSListItem = ({
loading = null,
error = null,
children,
fetcher,
params = null,
initialData = NO_INITIAL_DATA,
}) => {
const missingInitialData = useRef(initialData === NO_INITIAL_DATA);
const [resource, setResourceStatus] = useState(
  missingInitialData.current
    ? {
        state: "idle",
      }
    : { state: "success", data: initialData }
);
const { state, data } = resource;

useEffect(() => {
  if (!fetcher) {
    return;
  }

  if (!missingInitialData.current) {
    missingInitialData.current = true;
    return;
  }

  fetcher(params)
    .then(async (data) => {
      setResourceStatus({
        state: "success",
        error: "null",
        data,
      });
    })
    .catch((error) => {
      setResourceStatus({
        state: "error",
        message: error instanceof Error ? error.message : error,
      });
    });
}, [params]);

if (state === "loading") {
  return loading;
}

if (state === "error") {
  return error;
}

if (state === "success" && data) {
  return children(data);
}

return null;
};
`,
        },
        {
          name: 'cms-list',
          fileType: FileType.JS,
          content: `import { useEffect, useState, useRef } from "react";
/**
* - @param loading - JSX to display when the componet is in loading state.
* - @param error - JSX to display when the compnent hit a error state
* - @param empty - empty state of the component
* - @param children - Use for the renderProps patter to call the parent
* - @param fetcher - A promise from which we need to derive another three states, loading, error, data
* - @param params - Params that need to be passed while fetching the resource.
* - @param initialData - This is used to avoid the loading state, and fetch the new data when there is a change in the params
*/

const NO_INITIAL_DATA = Symbol(null);

export const CMSListing = ({
  loading = null,
  error = null,
  empty = null,
  children,
  fetcher,
  params,
  initialData = NO_INITIAL_DATA,
}) => {
  const missingInitialData = useRef(initialData === NO_INITIAL_DATA);
  const [resource, setResourceStatus] = useState(
    missingInitialData.current
      ? {
          state: "idle",
        }
      : { state: "success", data: initialData }
  );
  const { state, data } = resource;

  useEffect(() => {
    if (!fetcher) {
      return;
    }

    if (!missingInitialData.current) {
      missingInitialData.current = true;
      return;
    }

    setResourceStatus({ state: "loading", error: null });
    fetcher(params)
      .then(async (data) => {
        setResourceStatus({
          state: "success",
          error: "null",
          data,
        });
      })
      .catch((error) => {
        setResourceStatus({
          state: "error",
          message: error instanceof Error ? error.message : error,
        });
      });
  }, [params]);

  if (state === "loading") {
    return loading;
  }

  if (state === "error") {
    return error;
  }

  if (state === "success" && data?.length === 0) {
    return empty;
  }

  if (state === "success" && data?.length > 0) {
    return data.map((data) => children(data));
  }

  return null;
};
`,
        },
      ],
      subFolders: [],
    },
  ],
}

export default projectTemplate
