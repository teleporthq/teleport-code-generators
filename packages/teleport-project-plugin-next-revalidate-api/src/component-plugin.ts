import {
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
  FileType,
  ProjectUIDL,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { generateCallbackExpression, generateResponseWithStatus } from './utils'

interface NextCacheValidationProps {
  routeMappers: Record<string, string[]>
  webhook: ProjectUIDL['resources']['cache']['webhook']
  /** The env var holding the CMS webhook's secret (the editor's `WEBHOOK_SECRET`). */
  cacheHandlerSecret?: string
}

/** The header the CMS sends the webhook's secret in. */
export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret'
export const DEFAULT_WEBHOOK_SECRET_ENV = 'WEBHOOK_SECRET'

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Who may make the site rebuild its pages: only a caller presenting the CMS
 * webhook's secret, compared in constant time — in the `x-webhook-secret`
 * header, else (a webhook set up with the address the editor showed before)
 * in the query parameter named like the secret (`?WEBHOOK_SECRET=…`). Without a
 * secret — unset, blank, or the export's unresolved `teleporthq.secrets.`
 * placeholder — nobody may: an open rebuild endpoint lets anyone make the site
 * re-render its pages on demand.
 */
const authorizeWebhookSource = (
  secretEnv: string
): string => `// GENERATED: the CMS webhook's secret check.
function trimmedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function webhookSecretGiven(req) {
  var header = trimmedText(req && req.headers ? req.headers[${JSON.stringify(
    WEBHOOK_SECRET_HEADER
  )}] : undefined);
  if (header) {
    return header;
  }
  return trimmedText(req && req.query ? req.query[${JSON.stringify(secretEnv)}] : undefined);
}

function isAuthorizedWebhook(req) {
  var secret = trimmedText(process.env[${JSON.stringify(secretEnv)}]);
  if (!secret || secret.indexOf('teleporthq.secrets.') === 0) {
    return false;
  }
  var given = webhookSecretGiven(req);
  if (!given) {
    return false;
  }
  // Digests of both sides: always the same length, so the compare reveals
  // nothing about the secret, not even how long it is.
  var crypto = require('crypto');
  var a = crypto.createHash('sha256').update(given).digest();
  var b = crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}
`

export const createNextCacheValidationPlugin: ComponentPluginFactory<NextCacheValidationProps> = (
  config
) => {
  const { webhook, routeMappers = {}, cacheHandlerSecret } = config

  const cacheValidationPlugin: ComponentPlugin = async (structure) => {
    const { dependencies, chunks } = structure

    const webhookHandlerContent: types.Statement[] = [
      types.expressionStatement(
        types.awaitExpression(
          types.callExpression(types.identifier(webhook.name), [
            types.identifier('req'),
            generateCallbackExpression(routeMappers),
          ])
        )
      ),
      generateResponseWithStatus(200, true),
    ]

    // Always checked: a webhook without a secret refuses every caller.
    webhookHandlerContent.unshift(
      types.ifStatement(
        types.unaryExpression(
          '!',
          types.callExpression(types.identifier('isAuthorizedWebhook'), [types.identifier('req')])
        ),
        types.blockStatement([generateResponseWithStatus(401, false)])
      )
    )

    const componentChunkContent = types.exportDefaultDeclaration(
      types.functionDeclaration(
        types.identifier('handler'),
        [types.identifier('req'), types.identifier('res')],
        types.blockStatement([
          types.tryStatement(
            types.blockStatement(webhookHandlerContent),
            types.catchClause(
              types.identifier('error'),
              types.blockStatement([
                types.expressionStatement(
                  types.callExpression(
                    types.memberExpression(types.identifier('console'), types.identifier('log')),
                    [types.identifier('error')]
                  )
                ),
                generateResponseWithStatus(500, false),
              ])
            )
          ),
        ]),
        false,
        true
      )
    )

    const secretEnv =
      cacheHandlerSecret && ENV_NAME_RE.test(cacheHandlerSecret)
        ? cacheHandlerSecret
        : DEFAULT_WEBHOOK_SECRET_ENV
    chunks.push({
      name: 'revalidateSecretChunk',
      type: ChunkType.STRING,
      fileType: FileType.JS,
      content: authorizeWebhookSource(secretEnv),
      linkAfter: ['import-local', 'import-lib', 'import-pack'],
    })

    chunks.push({
      name: 'revalidateChunk',
      type: ChunkType.AST,
      fileType: FileType.JS,
      content: componentChunkContent,
      linkAfter: ['import-local', 'import-lib', 'import-pack', 'revalidateSecretChunk'],
    })

    dependencies[webhook.name] = webhook.dependency

    return structure
  }

  return cacheValidationPlugin
}
