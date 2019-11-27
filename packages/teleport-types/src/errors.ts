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

// Now Integration

export class NowMissingTokenError extends TeleportError {
  constructor() {
    super('No access token provided')
  }
}

export class NowInvalidTokenError extends TeleportError {
  constructor() {
    super('The now token you have provided is invalid')
  }
}

export class NowProjectTooBigError extends TeleportError {
  constructor() {
    super('Project size exceeds 6MB, the maximum allowed for a now deploy')
  }
}

export class NowRateLimiterError extends TeleportError {
  constructor() {
    super('Too many requests to now. Please try again later')
  }
}

export class NowDeploymentError extends TeleportError {
  constructor() {
    super('The now deployment returned an ERROR status')
  }
}

export class NowDeploymentTimeoutError extends TeleportError {
  constructor() {
    super('Now deployment timed out')
  }
}

export class NowUnexpectedError extends TeleportError {
  constructor(errorObj: Record<string, unknown>) {
    super(`Unexpected error when publishing to Now\nReceived: ${JSON.stringify(errorObj)}`)
  }
}

export class NowServerError extends TeleportError {
  constructor() {
    super('Now service is currently unavailable. Please try again later')
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
