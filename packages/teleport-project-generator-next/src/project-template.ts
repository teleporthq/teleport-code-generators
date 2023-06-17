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

const CMSListItem = ({
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

export default CMSListItem
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

const CMSList = ({
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

export default CMSList
  `,
        },
      ],
    },
  ],
}

export default projectTemplate
