import { SameOriginRequest } from '@teleporthq/teleport-shared'

/**
 * `__tqIsSameOriginRequest(req)` lives in teleport-shared so every package's
 * routes (this plugin's and teleport-project-generator-next's) emit the same
 * check. This module keeps the plugin's import path.
 */
export const SAME_ORIGIN_REQUEST_FUNCTION = SameOriginRequest.SAME_ORIGIN_REQUEST_FUNCTION
export const SAME_ORIGIN_REQUEST_SOURCE = SameOriginRequest.SAME_ORIGIN_REQUEST_SOURCE
