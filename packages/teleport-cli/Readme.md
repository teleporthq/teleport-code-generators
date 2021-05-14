## @teleporthq/teleport-cli

### Clone a Project

```shell
teleport clone --link <link-to-project> --path <sys-path>

teleport clone -l https://repl.teleporthq.io/project/2c5878e9-1bbc-4f7c-a27a-b8822dd39571

teleport clone --link https://teleport-gui-git-development-teleport-team.vercel.app/projects/new-project-zan7
```

### Clone a Component

```shell
teleport clone --link <link-to-component> --path <sys-path>

teleport clone --link https://repl.teleporthq.io/\?uidlLink\=35c82f1c-d272-4f8b-8a3f-5fa44702a1e6\&flavor\=React\&style\=CSS-Modules

teleport clone --link https://teleport-gui-git-development-teleport-team.vercel.app/projects/new-project-zan7/editor/5c3c97d9-98e9-4649-b654-b9103a99c200 --path /components
```

### Format
After cloning and resolving merge conflicts. If we want to format, please run

```shell
teleport format --path <sys-path>

teleport format -p /components

teleport format
```

### Sync

Using `teleport.config.json` and sync's the project and component's used.

```shell
teleport sync
```

We can use `--force` to `overwrite` local files with remote changes. 

```shell
teleport sync --force
```

### Init

Creates a `teleport.config.json` in a existing project

```shell
teleport init
```

### Dev Workflow

- Install `dependencies` using `yarn` in the root folder. Under `teleport-code-generator`.
- Run `yarn build` to build the project.
- Run `yarn link` to create a `sym-link`.
- Now go to the required folder and run `yarn link "@teleporthq/teleport-cli"`where we want to use the command line.
- To run the `cli` in watch mode, please run `yarn dev`. This will re-complie the `.ts` files every-time we make changes.

