export class TeleportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

export class ComponentValidationError extends TeleportError {
  constructor(errorString: string) {
    super(errorString)
  }
}

export class ProjectValidationError extends TeleportError {
  constructor(errorString: string) {
    super(errorString)
  }
}

export class MissingProjectUIDLError extends TeleportError {
  constructor() {
    super('No project UIDL provided')
  }
}

export class MissingProjectGeneratorError extends TeleportError {
  constructor() {
    super('No generator provided')
  }
}

export class MissingComponentUIDLError extends TeleportError {
  constructor() {
    super('No component UIDL provided')
  }
}

export class InvalidProjectTypeError extends TeleportError {
  constructor(projectType: string) {
    super(`Invalid ProjectType: ${projectType}`)
  }
}

export class InvalidPublisherTypeError extends TeleportError {
  constructor(publisherType: string) {
    super(`Invalid PublisherType: ${publisherType}`)
  }
}

// CodeSandbox Integration

export class CodeSandboxProjectTooBigError extends TeleportError {
  constructor() {
    super('Unfortunately your project is too big for the current CodeSandbox integration')
  }
}

export class CodeSandboxUnexpectedError extends TeleportError {
  constructor(errorObj: Record<string, unknown>) {
    super(`Unexpected error when publishing to CodeSandbox\nReceived: ${JSON.stringify(errorObj)}`)
  }
}

export class CodeSandboxServerError extends TeleportError {
  constructor() {
    super('The request to CodeSandbox returned 500')
  }
}

// Vercel Integration

export class VercelMissingTokenError extends TeleportError {
  constructor() {
    super('No access token provided')
  }
}

export class VercelDeploymentError extends TeleportError {
  constructor() {
    super('The vercel deployment returned an ERROR status')
  }
}

export class VercelDeploymentTimeoutError extends TeleportError {
  constructor() {
    super('Vercel deployment timed out')
  }
}

export class VercelServerError extends TeleportError {
  constructor() {
    super('Vercel service is currently unavailable. Please try again later')
  }
}

// GitHub Integration

export class GithubMissingAuthError extends TeleportError {
  constructor() {
    super('No auth method provided')
  }
}

export class GithubMissingRepoError extends TeleportError {
  constructor() {
    super('No repository provided')
  }
}

export class GithubInvalidTokenError extends TeleportError {
  constructor() {
    super('The GitHub token you have provided is invalid')
  }
}

export class GithubUnexpectedError extends TeleportError {
  constructor(errorObj: Record<string, unknown>) {
    super(`Unexpected error when publishing to GitHub\nReceived: ${JSON.stringify(errorObj)}`)
  }
}

export class GithubServerError extends TeleportError {
  constructor() {
    super('GitHub service is currently unavailable. Please try again later')
  }
}

// Other publisher errors

export class ZipUnexpectedError extends TeleportError {
  constructor(errorObj: Record<string, unknown>) {
    super(`Unexpected error when creating the zip file\nReceived: ${JSON.stringify(errorObj)}`)
  }
}

export class DiskUnexpectedError extends TeleportError {
  constructor(errorObj: Record<string, unknown>) {
    super(
      `Unexpected error when writing the project to disk\nReceived: ${JSON.stringify(errorObj)}`
    )
  }
}

export class ParserError extends TeleportError {
  constructor(error: string) {
    super(error)
  }
}

// Plugin Errors
export class PluginStyledJSX extends TeleportError {
  constructor(error: string) {
    super(error)
  }
}

export class PluginCssModules extends TeleportError {
  constructor(error: string) {
    super(error)
  }
}

export class PluginCSS extends TeleportError {
  constructor(error: string) {
    super(error)
  }
}

export class PluginStyledComponent extends TeleportError {
  constructor(error: string) {
    super(error)
  }
}

export class PluginReactJSS extends TeleportError {
  constructor(error: string) {
    super(error)
  }
}

export class HTMLComponentGeneratorError extends TeleportError {
  constructor(error: string) {
    super(error)
  }
}
