import {
  ProjectPlugin,
  ProjectPluginStructure,
  ProjectUIDL,
  ProjectStrategy,
  FileType,
  UIDLAuthentication,
} from '@teleporthq/teleport-types'
import {
  splitIntoSegments,
  resolveNodeExecutionEnv,
  redactServerNodeConfig,
} from './segment-splitter'
import {
  generateServerSegmentAPIRoute,
  generateStreamingServerSegmentAPIRoute,
  generateCronAPIRoute,
  generateWebhookWorkflowAPIRoute,
  getAPIRouteFileName,
  getCronRouteFileName,
  getWebhookRouteFileName,
  getWebhookRoutePath,
  hasStreamingAINode,
} from './api-route-generator'
import { collectSecrets, collectSecretReferenceEnvNames } from './secret-collector'
import {
  collectUsedNodeTypes,
  projectUsesRealtime,
  collectUsedRealtimeActionTypes,
} from './graph-utils'
import { nodeRegistry } from './nodes'
import {
  generateClientRuntimeCode,
  generateServerRuntimeCode,
  generateSharedRuntimeUtilsCode,
} from './executor-generator'
import {
  generateRealtimeServerHelperCode,
  generateRealtimeClientCode,
  generateRealtimeTokenRoute,
  generateRealtimeJoinRoute,
  generateRealtimeLeaveRoute,
  generateRealtimeMessageRoute,
  generateRealtimeEventRoute,
  generateRealtimeChannelsListRoute,
  generateRealtimeChannelsMembersRoute,
} from './realtime-generator'
import {
  generateAuthOptionsFile,
  generateHashPasswordFile,
  generateNextAuthRouteFile,
  generateSignupRouteFile,
  generateMiddlewareFile,
  generateSessionProviderWrapper,
  getDatabaseDriverDependencies,
} from './auth-generator'
import { generateInvoiceFiles, resolveInvoiceDataSource } from './invoice'
import { generateWebhookFiles } from './webhook-generator'
import { needsDataAPIRoute, generateDataAPIRoute } from './data-api-route-generator'
import {
  needsRuntimeStorageRoute,
  generateRuntimeStorageUploadRoute,
} from './runtime-storage-generator'
import { rewriteLowStockCustomHandlers } from './ecommerce-customhandler-rewriter'
import { assertWorkflowsAreSecure } from './security-scanner'

export class NextWorkflowProjectPlugin implements ProjectPlugin {
  private static INLINE_HANDLED_NODE_TYPES = new Set([
    'general-if-statement',
    'general-switch',
    'general-loop',
    'general-parallel',
  ])
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, strategy } = structure

    // Codegen-time security gate. Throws CodegenSecurityError if any
    // `general-custom-js` body references a protected platform secret
    // or uses an obvious sandbox-escape primitive. Backstop for the GUI
    // and services-worker static checks; surfaces the failure before
    // any code is emitted.
    assertWorkflowsAreSecure(uidl.workflows)

    if (uidl.workflows?.workflows) {
      const pageRouteMap = this.buildPageRouteMap(uidl, strategy)

      const unresolvedPageIds = new Set<string>()
      for (const wf of Object.values(uidl.workflows.workflows) as any[]) {
        for (const node of wf.nodes || []) {
          if (node.type === 'navigation-go-to-page' && node.config?.pageId) {
            const resolved = pageRouteMap[node.config.pageId]
            if (resolved) {
              node.config.pageId = resolved
            } else {
              // The page id isn't in the route map (e.g. an auth page like
              // sign-in registered outside routeDef/authPages). The mapper
              // already stamped the real route on `targetPage.staticUrl`, so
              // prefer that over leaving a raw page id that 404s at runtime.
              const staticUrl = (node.config.targetPage as { staticUrl?: unknown } | undefined)
                ?.staticUrl
              if (typeof staticUrl === 'string' && staticUrl.charAt(0) === '/') {
                node.config.pageId = staticUrl
              } else {
                unresolvedPageIds.add(node.config.pageId)
              }
            }
          }
        }
      }

      if (unresolvedPageIds.size > 0) {
        const defaultRouteUrl = this.getDefaultRouteUrl(uidl, strategy)
        if (defaultRouteUrl !== null) {
          const mappedValues = new Set(Object.values(pageRouteMap))
          if (!mappedValues.has(defaultRouteUrl)) {
            for (const pid of unresolvedPageIds) {
              pageRouteMap[pid] = defaultRouteUrl
            }
            for (const wf of Object.values(uidl.workflows.workflows) as any[]) {
              for (const node of wf.nodes || []) {
                if (
                  node.type === 'navigation-go-to-page' &&
                  node.config?.pageId &&
                  unresolvedPageIds.has(node.config.pageId)
                ) {
                  node.config.pageId = pageRouteMap[node.config.pageId]
                }
              }
            }
          }
        }
      }
    }

    if (uidl.globals?.env) {
      const oauthCredentialKeys = collectOAuthCredentialEnvKeys(uidl.authentication)
      for (const key of Object.keys(uidl.globals.env)) {
        uidl.globals.env[key] = resolveAuthEnvValue(key, uidl.globals.env[key], oauthCredentialKeys)
      }
    }

    // Repair AI-generated customHandler nodes that hard-code values the
    // merchant configures via the e-commerce settings (low-stock
    // threshold, alert email payload). Must run BEFORE the segment
    // splitter / generator pipeline so the rewritten code lands in the
    // emitted segment files. See `ecommerce-customhandler-rewriter.ts`
    // for the patterns we recognise and the settings we source.
    rewriteLowStockCustomHandlers(uidl)

    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files, dependencies } = structure

    const hasAuthentication = uidl.authentication && uidl.authentication.enabled
    if (hasAuthentication) {
      this.generateAuthFiles(uidl.authentication, structure)
    }

    if (!uidl.workflows || !uidl.workflows.workflows) {
      if (uidl.invoiceSettings?.enabled) {
        const { dataSourceType, dataSourceConfig } = resolveInvoiceDataSource(structure)
        generateInvoiceFiles(uidl.invoiceSettings, structure, dataSourceType, dataSourceConfig)

        // The generated /api/invoices/generate route uploads the rendered PDF
        // to the runtime-storage worker via uploadInvoicePdfToRuntimeStorage.
        // Register the env vars here too — this early-return path would
        // otherwise bypass the env registration block lower down.
        if (!uidl.globals.env) {
          uidl.globals.env = {}
        }
        if (!uidl.globals.env.RUNTIME_STORAGE_URL) {
          uidl.globals.env.RUNTIME_STORAGE_URL = ''
        }
        if (!uidl.globals.env.RUNTIME_STORAGE_API_KEY) {
          uidl.globals.env.RUNTIME_STORAGE_API_KEY = ''
        }
        if (!uidl.globals.env.RUNTIME_STORAGE_PROJECT_ID) {
          uidl.globals.env.RUNTIME_STORAGE_PROJECT_ID = ''
        }
      }

      generateWebhookFiles(structure, uidl.invoiceSettings)

      if (hasAuthentication) {
        this.injectSessionProviderIntoApp(structure)
      }
      return structure
    }

    const allWorkflows = uidl.workflows.workflows
    const customNodes = uidl.workflows.customNodes || {}
    const usedNodeTypes = collectUsedNodeTypes(uidl.workflows)

    files.set('workflow-runtime-utils', {
      path: ['utils', 'workflows'],
      files: [
        {
          name: 'runtime-utils',
          fileType: FileType.JS,
          content: generateSharedRuntimeUtilsCode(),
        },
      ],
    })

    files.set('workflow-client-runtime', {
      path: ['utils', 'workflows'],
      files: [
        {
          name: 'runtime',
          fileType: FileType.JS,
          content: generateClientRuntimeCode(),
        },
      ],
    })

    const clientHandlerCode = this.generateNodeHandlerFile(usedNodeTypes, 'client')
    if (clientHandlerCode) {
      files.set('workflow-client-handlers', {
        path: ['utils', 'workflows'],
        files: [
          {
            name: 'node-handlers-client',
            fileType: FileType.JS,
            content: clientHandlerCode,
          },
        ],
      })
    }

    // Build server segment info for custom nodes so they can call server-side API routes
    const customNodeServerUrls: Record<string, Record<string, string>> = {}
    if (Object.keys(customNodes).length > 0) {
      for (const [cnId, cn] of Object.entries(customNodes) as Array<[string, any]>) {
        const pseudoWorkflow = {
          nodes: cn.nodes || [],
          edges: cn.edges || [],
          trigger: { type: 'manual' },
        } as any
        const cnSegments = splitIntoSegments(pseudoWorkflow)
        const cnServerSegments = cnSegments.filter((s) => s.env === 'server')
        if (cnServerSegments.length > 0) {
          customNodeServerUrls[cnId] = {}
          for (const seg of cnServerSegments) {
            const isStreaming = hasStreamingAINode(seg)
            const apiContent = isStreaming
              ? generateStreamingServerSegmentAPIRoute(seg, cn.name || cnId)
              : generateServerSegmentAPIRoute(seg, cn.name || cnId)
            const fileName = getAPIRouteFileName(cnId, seg.id, cn.name || cnId)
            customNodeServerUrls[cnId][seg.id] = `/api/workflows/${fileName}`
            files.set(`workflow-api-cn-${cnId}-${seg.id}`, {
              path: ['pages', 'api', 'workflows'],
              files: [
                {
                  name: fileName,
                  fileType: FileType.JS,
                  content: apiContent,
                },
              ],
            })
          }
        }
      }

      const customNodeCode = this.generateCustomNodesFile(customNodes, customNodeServerUrls)
      files.set('workflow-custom-nodes', {
        path: ['utils', 'workflows'],
        files: [
          {
            name: 'custom-nodes',
            fileType: FileType.JS,
            content: customNodeCode,
          },
        ],
      })
    }

    let hasServerSegments = Object.keys(customNodeServerUrls).length > 0

    // Track which payment providers are already handled by a workflow-driven
    // webhook (event-webhook-received + webhookConfig) so we can skip the
    // legacy hard-coded webhook emission for those providers below.
    const webhookProvidersOwnedByWorkflows = new Set<'stripe' | 'paypal'>()

    for (const workflow of Object.values(allWorkflows) as any[]) {
      if (workflow.trigger.type === 'event-cron-triggered') {
        const cronContent = generateCronAPIRoute(workflow)
        const cronFileName = getCronRouteFileName(workflow)
        files.set(`workflow-cron-${workflow.id}`, {
          path: ['pages', 'api', 'workflows'],
          files: [
            {
              name: cronFileName,
              fileType: FileType.JS,
              content: cronContent,
            },
          ],
        })
        continue
      }

      if (workflow.trigger.type === 'event-webhook-received' && workflow.webhookConfig) {
        hasServerSegments = true
        const webhookContent = generateWebhookWorkflowAPIRoute(workflow, customNodes)
        const webhookFileName = getWebhookRouteFileName(workflow)
        const webhookPath = getWebhookRoutePath(workflow)
        files.set(`workflow-webhook-${workflow.id}`, {
          path: webhookPath,
          files: [
            {
              name: webhookFileName,
              fileType: FileType.JS,
              content: webhookContent,
            },
          ],
        })

        // Detect which payment provider this webhook is handling so the
        // legacy hard-coded emission (webhook-generator.ts) can be skipped
        // for the same provider. Uses both the URL path and the trigger's
        // signature algorithm as hints — the former is what the GUI emits,
        // the latter is a defence in case the path convention changes.
        const urlPath = (workflow.webhookConfig.urlPath || '').toLowerCase()
        const sigAlgorithm = (workflow.webhookConfig.signatureAlgorithm || '').toLowerCase()
        if (urlPath.includes('stripe') || sigAlgorithm.includes('stripe')) {
          webhookProvidersOwnedByWorkflows.add('stripe')
        }
        if (urlPath.includes('paypal') || sigAlgorithm.includes('paypal')) {
          webhookProvidersOwnedByWorkflows.add('paypal')
        }

        // signatureSecret may arrive as either a bare env-var-name string or a
        // DynamicNode {type:'dynamic', content:{referenceType:'secret', id:'NAME'}}.
        // Extract the underlying env-var name in both cases so the project
        // correctly pre-registers it in .env / .env.example.
        if (workflow.webhookConfig.signatureSecret) {
          const rawSecret = workflow.webhookConfig.signatureSecret as unknown
          let secretEnvName = ''
          if (typeof rawSecret === 'string') {
            secretEnvName = rawSecret
          } else if (rawSecret && typeof rawSecret === 'object') {
            const anyVal = rawSecret as {
              type?: string
              content?: { referenceType?: string; id?: string }
            }
            if (
              anyVal.type === 'dynamic' &&
              anyVal.content &&
              anyVal.content.referenceType === 'secret' &&
              typeof anyVal.content.id === 'string'
            ) {
              secretEnvName = anyVal.content.id
            }
          }
          if (secretEnvName) {
            if (!uidl.globals.env) {
              uidl.globals.env = {}
            }
            if (!uidl.globals.env[secretEnvName]) {
              uidl.globals.env[secretEnvName] = ''
            }
          }
        }
        continue
      }

      const segments = splitIntoSegments(workflow)
      const serverSegments = segments.filter((s) => s.env === 'server')

      for (const serverSeg of serverSegments) {
        hasServerSegments = true
        const isStreaming = hasStreamingAINode(serverSeg)
        const apiContent = isStreaming
          ? generateStreamingServerSegmentAPIRoute(serverSeg, workflow.name)
          : generateServerSegmentAPIRoute(serverSeg, workflow.name)
        const fileName = getAPIRouteFileName(workflow.id, serverSeg.id, workflow.name)

        files.set(`workflow-api-${workflow.id}-${serverSeg.id}`, {
          path: ['pages', 'api', 'workflows'],
          files: [
            {
              name: fileName,
              fileType: FileType.JS,
              content: apiContent,
            },
          ],
        })
      }
    }

    if (hasServerSegments) {
      files.set('workflow-server-runtime', {
        path: ['utils', 'workflows'],
        files: [
          {
            name: 'server-runtime',
            fileType: FileType.JS,
            content: generateServerRuntimeCode(),
          },
        ],
      })

      const serverHandlerCode = this.generateNodeHandlerFile(usedNodeTypes, 'server')
      if (serverHandlerCode) {
        files.set('workflow-server-handlers', {
          path: ['utils', 'workflows'],
          files: [
            {
              name: 'node-handlers-server',
              fileType: FileType.JS,
              content: serverHandlerCode,
            },
          ],
        })
      }
    }

    if (needsDataAPIRoute(usedNodeTypes)) {
      // Resolve the actual IDENTITY (users) table, not just the first auth-table
      // key. Getting this wrong is a security hole: the /api/data guard only
      // protects AUTH_USERS_TABLE, so if it points at an auxiliary table like
      // `password_reset_tokens`, the real `users` table is left mutable
      // unauthenticated. The identity table is the one storing credentials
      // (an email/login column AND a password column).
      const authUsersTableName = ((): string | undefined => {
        if (!uidl.authentication?.enabled || !uidl.authentication?.tables) {
          return undefined
        }
        const tables = uidl.authentication.tables
        const names = Object.keys(tables)
        if (names.length === 0) return 'users'
        const cols = (n: string) => (tables[n] || []).map((c) => (c.name || '').toLowerCase())
        const has = (n: string, re: RegExp) => cols(n).some((c) => re.test(c))
        const identity = names.find(
          (n) =>
            has(n, /^(email|e_mail|username|user_name|login|user_email)$/) &&
            has(n, /pass(word)?|pwd|password_hash|hashed_password/)
        )
        if (identity) return identity
        const named = names.find((n) =>
          /^(app_)?users?$|^members?$|^customers?$|^accounts?$/i.test(n)
        )
        if (named) return named
        const AUX = /token|session|verification|reset|oauth|provider|magic|otp|account_link/i
        const nonAux = names.find((n) => !AUX.test(n))
        return nonAux || names[0]
      })()
      // Low-stock auto-fire: the data-api wakes up the
      // /api/ecommerce/low-stock-alert endpoint on the place-order
      // workflow's stock-check SELECT. Both flags are sourced from
      // the ecommerce settings so the data-api short-circuits when
      // the merchant turned the feature off — no detection cost
      // when stock management isn't even configured.
      const ecom = uidl.ecommerceSettings
      const lowStockAlertsEnabled = !!(
        ecom &&
        ecom.stockManagement &&
        ecom.stockManagementConfig?.lowStockAlerts &&
        ecom.stockManagementConfig?.lowStockAlertConfig?.provider
      )
      const lowStockThreshold =
        typeof ecom?.stockManagementConfig?.lowStockThreshold === 'number'
          ? ecom.stockManagementConfig.lowStockThreshold
          : 5
      files.set('workflow-data-api-route', {
        path: ['pages', 'api', 'data'],
        files: [
          {
            name: '[...params]',
            fileType: FileType.JS,
            content: generateDataAPIRoute({
              authUsersTableName,
              lowStockAlertsEnabled,
              lowStockThreshold,
            }),
          },
        ],
      })
    }

    if (needsRuntimeStorageRoute(usedNodeTypes)) {
      files.set('runtime-storage-upload-route', {
        path: ['pages', 'api', 'runtime-storage'],
        files: [
          {
            name: 'upload',
            fileType: FileType.JS,
            content: generateRuntimeStorageUploadRoute(),
          },
        ],
      })
    }

    // Runtime-storage env vars are needed whenever something in the generated
    // project will talk to the runtime-storage worker. Today that is either:
    //  - a workflow uses a file-storage-* node (uses /api/runtime-storage/upload), OR
    //  - invoice generation is enabled (server-side /api/invoices/generate uploads
    //    the rendered PDF directly via uploadInvoicePdfToRuntimeStorage). The
    //    invoice path does NOT add a file-storage-upload node to the UIDL, so it
    //    would otherwise be missed by needsRuntimeStorageRoute.
    const needsRuntimeStorageEnv =
      needsRuntimeStorageRoute(usedNodeTypes) || Boolean(uidl.invoiceSettings?.enabled)
    if (needsRuntimeStorageEnv) {
      if (!uidl.globals.env) {
        uidl.globals.env = {}
      }
      if (!uidl.globals.env.RUNTIME_STORAGE_URL) {
        uidl.globals.env.RUNTIME_STORAGE_URL = ''
      }
      if (!uidl.globals.env.RUNTIME_STORAGE_API_KEY) {
        uidl.globals.env.RUNTIME_STORAGE_API_KEY = ''
      }
      if (!uidl.globals.env.RUNTIME_STORAGE_PROJECT_ID) {
        uidl.globals.env.RUNTIME_STORAGE_PROJECT_ID = ''
      }
    }

    const secrets = collectSecrets(uidl.workflows)
    if (secrets.length > 0) {
      if (!uidl.globals.env) {
        uidl.globals.env = {}
      }
      for (const secret of secrets) {
        uidl.globals.env[secret.envVarName] = secret.value
      }
    }

    // Node-config credentials stored as project-secret references (SMS/AI/
    // integration/email keys, etc.) are pre-registered as
    // `teleporthq.secrets.<KEY>` placeholders so the deploy step resolves each
    // from the project secret store. The runtime resolves the reference object
    // to `process.env[<KEY>]` (see resolveSecret in executor-generator.ts).
    // Wrapped defensively: a malformed workflow must never abort generation.
    try {
      const secretReferenceEnvNames = collectSecretReferenceEnvNames(uidl.workflows)
      if (secretReferenceEnvNames.length > 0) {
        if (!uidl.globals.env) {
          uidl.globals.env = {}
        }
        for (const envName of secretReferenceEnvNames) {
          if (envName && !uidl.globals.env[envName]) {
            uidl.globals.env[envName] = `teleporthq.secrets.${envName}`
          }
        }
      }
    } catch (_secretRefErr) {
      // Non-fatal: the project still generates; only the placeholder
      // pre-registration is skipped if something is unexpectedly shaped.
    }

    if (usedNodeTypes.has('payment-charge-user')) {
      if (!uidl.globals.env) {
        uidl.globals.env = {}
      }
      if (!uidl.globals.env.STRIPE_SECRET_KEY) {
        uidl.globals.env.STRIPE_SECRET_KEY = ''
      }
      if (!uidl.globals.env.PAYPAL_CLIENT_ID) {
        uidl.globals.env.PAYPAL_CLIENT_ID = ''
      }
      if (!uidl.globals.env.PAYPAL_CLIENT_SECRET) {
        uidl.globals.env.PAYPAL_CLIENT_SECRET = ''
      }
      // No PAYPAL_ENV — the runtime detects sandbox vs live from the
      // credentials themselves (see `paypalAuthenticate` in
      // payment-charge-user.ts) and caches the result.
    }

    const globalWorkflows = (Object.values(allWorkflows) as any[]).filter(
      (wf: any) =>
        wf.trigger.scope === 'global' &&
        wf.trigger.type !== 'event-cron-triggered' &&
        wf.trigger.type !== 'event-webhook-received'
    )

    if (globalWorkflows.length > 0) {
      const globalWorkflowCode = this.generateGlobalWorkflowsHook(globalWorkflows)
      files.set('workflow-global-hook', {
        path: ['utils', 'workflows'],
        files: [
          {
            name: 'global-workflows',
            fileType: FileType.JS,
            content: globalWorkflowCode,
          },
        ],
      })

      this.injectGlobalWorkflowsIntoApp(structure)
    }

    dependencies['node-fetch'] = '^2.7.0'

    this.collectNodeDependencies(usedNodeTypes, dependencies)

    if (projectUsesRealtime(uidl.workflows)) {
      this.generateRealtimeFiles(structure)
    }

    if (uidl.invoiceSettings?.enabled) {
      const { dataSourceType, dataSourceConfig } = resolveInvoiceDataSource(structure)
      generateInvoiceFiles(uidl.invoiceSettings, structure, dataSourceType, dataSourceConfig)
    }

    generateWebhookFiles(structure, uidl.invoiceSettings, {
      skipProviders: webhookProvidersOwnedByWorkflows,
    })

    // Toast is now pure DOM-based, no React provider component needed

    if (hasAuthentication) {
      this.injectSessionProviderIntoApp(structure)
    }

    return structure
  }

  private injectToasterIntoApp(structure: ProjectPluginStructure): void {
    const { files } = structure

    let appFile: any = null
    for (const [key, record] of files.entries()) {
      if (key === '_app' || key.includes('_app')) {
        appFile = record.files?.find(
          (f: any) => f.name === '_app' && (f.fileType === 'js' || f.fileType === 'tsx')
        )
        if (appFile) {
          break
        }
      }
    }

    if (!appFile || typeof appFile.content !== 'string') {
      return
    }
    if (appFile.content.includes('Toaster')) {
      return
    }

    let content = appFile.content

    const importStatement = `import { Toaster } from 'sonner';\n`
    const firstImportIdx = content.indexOf('import ')
    if (firstImportIdx >= 0) {
      content = content.slice(0, firstImportIdx) + importStatement + content.slice(firstImportIdx)
    } else {
      content = importStatement + content
    }

    const returnMatch = content.match(/return\s*\(\s*/)
    if (returnMatch && returnMatch.index !== undefined) {
      const afterReturn = returnMatch.index + returnMatch[0].length
      const restContent = content.slice(afterReturn)
      const closingParenIdx = findMatchingClosingParen(restContent)
      if (closingParenIdx >= 0) {
        const innerJSX = restContent.slice(0, closingParenIdx)
        const afterClosing = restContent.slice(closingParenIdx)
        content =
          content.slice(0, afterReturn) + `<>${innerJSX}<Toaster richColors /></>` + afterClosing
      }
    }

    appFile.content = content
  }

  private generateRealtimeFiles(structure: ProjectPluginStructure): void {
    const { uidl, files, dependencies } = structure

    dependencies.ably = '^2.6.0'

    if (!uidl.globals.env) {
      uidl.globals.env = {}
    }
    if (!uidl.globals.env.REALTIME_SERVER_URL) {
      uidl.globals.env.ablyE_SERVER_URL = ''
    }
    if (!uidl.globals.env.REALTIME_SERVER_API_KEY) {
      uidl.globals.env.REALTIME_SERVER_API_KEY = ''
    }

    files.set('realtime-server-helper', {
      path: ['utils', 'realtime'],
      files: [
        {
          name: 'server',
          fileType: FileType.JS,
          content: generateRealtimeServerHelperCode(),
        },
      ],
    })

    files.set('realtime-client', {
      path: ['utils', 'realtime'],
      files: [
        {
          name: 'client',
          fileType: FileType.JS,
          content: generateRealtimeClientCode(),
        },
      ],
    })

    files.set('realtime-api-token', {
      path: ['pages', 'api', 'realtime'],
      files: [
        {
          name: 'token',
          fileType: FileType.JS,
          content: generateRealtimeTokenRoute(),
        },
      ],
    })

    files.set('realtime-api-join', {
      path: ['pages', 'api', 'realtime'],
      files: [
        {
          name: 'join',
          fileType: FileType.JS,
          content: generateRealtimeJoinRoute(),
        },
      ],
    })

    files.set('realtime-api-leave', {
      path: ['pages', 'api', 'realtime'],
      files: [
        {
          name: 'leave',
          fileType: FileType.JS,
          content: generateRealtimeLeaveRoute(),
        },
      ],
    })

    const usedRealtimeActions = collectUsedRealtimeActionTypes(uidl.workflows)

    if (usedRealtimeActions.has('realtime-send-channel-message')) {
      files.set('realtime-api-message', {
        path: ['pages', 'api', 'realtime'],
        files: [
          {
            name: 'message',
            fileType: FileType.JS,
            content: generateRealtimeMessageRoute(),
          },
        ],
      })
    }

    if (usedRealtimeActions.has('realtime-send-channel-event')) {
      files.set('realtime-api-event', {
        path: ['pages', 'api', 'realtime'],
        files: [
          {
            name: 'event',
            fileType: FileType.JS,
            content: generateRealtimeEventRoute(),
          },
        ],
      })
    }

    if (usedRealtimeActions.has('realtime-list-channels')) {
      files.set('realtime-api-channels-list', {
        path: ['pages', 'api', 'realtime', 'channels'],
        files: [
          {
            name: 'list',
            fileType: FileType.JS,
            content: generateRealtimeChannelsListRoute(),
          },
        ],
      })
    }

    if (usedRealtimeActions.has('realtime-list-channel-members')) {
      files.set('realtime-api-channels-members', {
        path: ['pages', 'api', 'realtime', 'channels'],
        files: [
          {
            name: 'members',
            fileType: FileType.JS,
            content: generateRealtimeChannelsMembersRoute(),
          },
        ],
      })
    }
  }

  private collectNodeDependencies(
    usedNodeTypes: Set<string>,
    dependencies: Record<string, string>
  ): void {
    usedNodeTypes.forEach((nodeType) => {
      const generator = nodeRegistry[nodeType]
      if (!generator || !generator.dependencies) {
        return
      }

      for (const [pkg, version] of Object.entries(generator.dependencies)) {
        if (!dependencies[pkg]) {
          dependencies[pkg] = version
        }
      }
    })
  }

  private injectGlobalWorkflowsIntoApp(structure: ProjectPluginStructure): void {
    const { files } = structure

    // Find the _app file in the files Map
    let appFile: any = null

    for (const [key, record] of files.entries()) {
      if (key === '_app' || key.includes('_app')) {
        appFile = record.files?.find(
          (f: any) => f.name === '_app' && (f.fileType === 'js' || f.fileType === 'tsx')
        )
        if (appFile) {
          break
        }
      }
    }

    if (!appFile || typeof appFile.content !== 'string') {
      return
    }

    const importStatement = `import { useGlobalWorkflows } from '../utils/workflows/global-workflows';\n`
    const hookCall = `  useGlobalWorkflows();\n`

    if (appFile.content.includes('useGlobalWorkflows')) {
      return
    }

    let content = appFile.content
    if (!content.includes(importStatement.trim())) {
      const firstImportIdx = content.indexOf('import ')
      if (firstImportIdx >= 0) {
        content = content.slice(0, firstImportIdx) + importStatement + content.slice(firstImportIdx)
      } else {
        content = importStatement + content
      }
    }

    const fnBodyMatch = content.match(/function\s+MyApp\s*\([^)]*\)\s*\{/)
    if (fnBodyMatch && fnBodyMatch.index !== undefined) {
      const insertPos = fnBodyMatch.index + fnBodyMatch[0].length
      content = content.slice(0, insertPos) + '\n' + hookCall + content.slice(insertPos)
    }

    appFile.content = content
  }

  private generateNodeHandlerFile(usedNodeTypes: Set<string>, env: 'client' | 'server'): string {
    const handlers: string[] = []
    const exportNames: string[] = []

    usedNodeTypes.forEach((nodeType) => {
      if (NextWorkflowProjectPlugin.INLINE_HANDLED_NODE_TYPES.has(nodeType)) {
        return
      }

      const generator = nodeRegistry[nodeType]
      if (!generator) {
        return
      }

      const nodeEnv = generator.executionEnv
      const isRelevant = nodeEnv === env || nodeEnv === 'universal'

      if (!isRelevant) {
        return
      }

      if (env === 'server' && generator.generateServerHandler) {
        handlers.push(generator.generateServerHandler())
      } else {
        handlers.push(generator.generateHandler())
      }
      exportNames.push(nodeType)
    })

    if (handlers.length === 0) {
      return ''
    }

    const exports = exportNames.map((t) => `  '${t}': ${t.replace(/-/g, '_')}`).join(',\n')

    return `// Auto-generated workflow node handlers (${env})

${handlers.join('\n\n')}

module.exports = {
${exports}
};
`
  }

  private getDefaultRouteUrl(uidl: ProjectUIDL, strategy: ProjectStrategy): string | null {
    const routeDef = uidl.root?.stateDefinitions?.route
    if (!routeDef?.values || !routeDef.defaultValue) {
      return null
    }
    const defaultEntry = routeDef.values.find((rv: any) => rv.value === routeDef.defaultValue)
    if (!defaultEntry) {
      return null
    }
    if (defaultEntry.pageOptions?.navLink) {
      return defaultEntry.pageOptions.navLink
    }
    return '/'
  }

  private buildPageRouteMap(uidl: ProjectUIDL, strategy: ProjectStrategy): Record<string, string> {
    const map: Record<string, string> = {}
    const routeDef = uidl.root?.stateDefinitions?.route
    const useFileNameForNavigation = strategy.pages?.options?.useFileNameForNavigation ?? false

    if (routeDef?.values) {
      const defaultValue = routeDef.defaultValue
      for (const routeValue of routeDef.values as any[]) {
        if (!routeValue.pageId) {
          continue
        }
        if (routeValue.pageOptions?.fallback) {
          continue
        }
        const isHome = routeValue.value === defaultValue
        const navLink = routeValue.pageOptions?.navLink
        if (navLink) {
          map[routeValue.pageId] = navLink
        } else if (isHome) {
          map[routeValue.pageId] = '/'
        } else {
          const pageName = routeValue.value.toString()
          const fileName = pageName.replace(/\s+/g, '-').toLowerCase()
          map[routeValue.pageId] = '/' + (useFileNameForNavigation ? fileName : pageName)
        }
      }
    }

    const auth = (uidl as any).authentication
    if (auth?.authPages) {
      for (const authPage of Object.values(auth.authPages) as any[]) {
        if (authPage.pageId && authPage.route && !map[authPage.pageId]) {
          map[authPage.pageId] = authPage.route
        }
      }
    }

    return map
  }

  private generateCustomNodesFile(
    customNodes: Record<string, any>,
    customNodeServerUrls: Record<string, Record<string, string>>
  ): string {
    const functions: string[] = []

    for (const [id, cn] of Object.entries(customNodes)) {
      const safeId = id.replace(/[^a-zA-Z0-9]/g, '_')
      // SECURITY: the custom-nodes file ships to the browser (imported as
      // `utils/workflows/custom-nodes`). Redact each server node's config down
      // to the client-safe whitelist so raw SQL / data-source config never
      // reaches the page bundle. The intrinsic node env is used here (the full
      // node list is env-agnostic); the segment loop below redacts per its own
      // resolved segment env.
      const nodesJson = JSON.stringify(
        (cn.nodes || []).map((n: any) => ({
          ...n,
          config: redactServerNodeConfig(n.config, resolveNodeExecutionEnv(n)),
        }))
      )
      const edgesJson = JSON.stringify(cn.edges)
      const params = (cn.parameters || []).map((p: any) => p.key)

      // An `event-workflow-error` node in a custom node defines a rollback /
      // cleanup chain that must run when any upstream node throws. Without
      // plumbing its id into wfConfig + wrapping the segment loop in a
      // try/catch the chain is dead code (the top-level executor only looks
      // at the outer workflow's errorHandlerNodeId), so optimistic global
      // state updates would never be rolled back and toast-show error
      // notifications would never fire from inside a shared custom node.
      const errorHandlerNode = (cn.nodes || []).find(
        (n: any) => n && n.type === 'event-workflow-error'
      )
      const errorHandlerNodeId = errorHandlerNode ? errorHandlerNode.id : null

      const serverUrls = customNodeServerUrls[id]
      const hasServerSegments = serverUrls && Object.keys(serverUrls).length > 0

      if (hasServerSegments) {
        // Generate segment-based execution for custom nodes with server-side nodes
        const pseudoWorkflow = {
          nodes: cn.nodes || [],
          edges: cn.edges || [],
          trigger: { type: 'manual' },
        } as any
        const cnSegments = splitIntoSegments(pseudoWorkflow)
        const segmentsJson = JSON.stringify(
          cnSegments.map((s) => ({
            id: s.id,
            env: s.env,
            hasStreamingAI: hasStreamingAINode(s),
            nodes: s.nodes.map((n) => ({
              id: n.id,
              type: n.type,
              config: redactServerNodeConfig(n.config, s.env),
              stepNumber: n.stepNumber,
              label: n.label,
            })),
            edges: s.edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              sourceHandle: e.sourceHandle,
              targetHandle: e.targetHandle,
              data: e.data,
            })),
          }))
        )
        const serverUrlsJson = JSON.stringify(serverUrls)

        functions.push(`
// Custom workflow node: ${cn.name || id}
// ${cn.description || ''}
// Parameters: ${params.join(', ')}
async function customNode_${safeId}(outerContext, parameters, nodeHandlers) {
  var nodes = ${nodesJson};
  var edges = ${edgesJson};
  var segments = ${segmentsJson};
  var serverUrls = ${serverUrlsJson};
  var context = Object.assign({}, outerContext);
  context.__customParams = parameters;
  context.__isInsideCustomNode = true;
  var nodeIds = nodes.map(function(n) { return n.id; });
  context.__customNodeIds = nodeIds;
  context.__previousNodeResult = null;
  var wfConfig = { customNodes: __customNodeRegistry, nodes: nodes, edges: edges${
    errorHandlerNodeId ? `, errorHandlerNodeId: '${errorHandlerNodeId}'` : ''
  } };
  var executionId = Date.now().toString();
  var streamingInfo = __runtime.findStreamingAINodes(nodes, edges);
  var handledNodeIds = {};

  try {
  for (var si = 0; si < segments.length; si++) {
    var seg = segments[si];
    if (seg.env === 'client') {
      var clientNodes = seg.nodes.filter(function(n) { return !handledNodeIds[n.id] && !(context.__skippedNodes && context.__skippedNodes[n.id]); });
      if (clientNodes.length > 0) {
        await __utils.executeNodes(clientNodes, seg.edges, context, nodeHandlers, wfConfig, null, executionId);
      }
      // After a client segment with if-statements, mark non-taken branch
      // nodes as skipped using the FULL nodes array so branches that span
      // across server/client segments are correctly skipped.
      var __cIfNodes = seg.nodes.filter(function(n) { return n.type === 'general-if-statement' && context[n.id]; });
      for (var __ci = 0; __ci < __cIfNodes.length; __ci++) {
        var __cIfNode = __cIfNodes[__ci];
        var __cIfRes = context[__cIfNode.id];
        if (typeof __cIfRes.result === 'boolean') {
          var __cSkipH = __cIfRes.result ? 'false' : 'true';
          var __cSkipEdge = edges.find(function(e) { return e.source === __cIfNode.id && e.sourceHandle === __cSkipH; });
          if (__cSkipEdge) {
            var __cSkipBranch = __utils.collectBranchNodes(__cSkipEdge.target, nodes, edges, __cIfNode.id);
            if (!context.__skippedNodes) context.__skippedNodes = {};
            for (var __csk = 0; __csk < __cSkipBranch.length; __csk++) {
              context.__skippedNodes[__cSkipBranch[__csk].id] = true;
            }
          }
        }
      }
    } else if (seg.env === 'server') {
      // Skip entire server segment if all its nodes are in __skippedNodes
      // (matches the skipping logic in executeWorkflowWithSegments)
      if (context.__skippedNodes && seg.nodes.length > 0) {
        var __allSkipped = seg.nodes.every(function(n) { return context.__skippedNodes[n.id]; });
        if (__allSkipped) continue;
      }
      var segUrl = serverUrls[seg.id];
      if (segUrl) {
        if (seg.hasStreamingAI) {
          var streamHandled = await __runtime.callStreamingServerSegment(segUrl, context, streamingInfo, nodes, edges, nodeHandlers, wfConfig, executionId);
          Object.assign(handledNodeIds, streamHandled);
        } else {
          var serverResults = await __runtime.callServerSegment(segUrl, context);
          __runtime.mergeServerResults(context, serverResults);
          // Propagate non-taken if-statement branches from this server
          // segment into subsequent segments. Iterate every if-statement
          // in the segment (not just the last node), because mid-segment
          // if-statements followed by further nodes still affect
          // downstream segments.
          var segSorted = seg.nodes.slice().sort(function(a, b) { return (a.stepNumber || 0) - (b.stepNumber || 0); });
          var __segIfNodes = segSorted.filter(function(n) { return n.type === 'general-if-statement' && context[n.id]; });
          for (var __sifi = 0; __sifi < __segIfNodes.length; __sifi++) {
            var __sifNode = __segIfNodes[__sifi];
            var __sifRes = context[__sifNode.id];
            if (typeof __sifRes.result === 'boolean') {
              var __skH = __sifRes.result ? 'false' : 'true';
              var __skE = edges.find(function(e) { return e.source === __sifNode.id && e.sourceHandle === __skH; });
              if (__skE) {
                var __skNodes = __utils.collectBranchNodes(__skE.target, nodes, edges, __sifNode.id);
                if (!context.__skippedNodes) context.__skippedNodes = {};
                for (var __skI = 0; __skI < __skNodes.length; __skI++) {
                  context.__skippedNodes[__skNodes[__skI].id] = true;
                }
              }
            }
          }
          if (segSorted.length > 0 && context[segSorted[segSorted.length - 1].id]) {
            context.__previousNodeResult = context[segSorted[segSorted.length - 1].id];
          }
        }
      }
    }
    // If the last node returned __terminal, stop the segment loop
    if (context.__previousNodeResult && context.__previousNodeResult.__terminal) break;
  }
  } catch (__error) {
    if (__error && (__error.__skipErrorHandler || __error.__rateLimited)) {
      throw __error;
    }
    ${
      errorHandlerNodeId
        ? `var __firstErrorEdge = edges.filter(function(e) { return e.source === '${errorHandlerNodeId}'; })[0];
    if (__firstErrorEdge) {
      var __errorNodes = __utils.collectBranchNodes(__firstErrorEdge.target, nodes, edges, '${errorHandlerNodeId}');
      if (__errorNodes.length > 0) {
        context['${errorHandlerNodeId}'] = {
          error: { message: (__error && __error.message) || String(__error), stack: (__error && __error.stack) || '' },
          errorMessage: (__error && __error.message) || String(__error)
        };
        try {
          await __utils.executeNodes(__errorNodes, edges, context, nodeHandlers, wfConfig, null, executionId);
        } catch (__innerErr) {
          console.error('Custom workflow node error handler failed:', __innerErr);
        }
      } else {
        throw __error;
      }
    } else {
      throw __error;
    }`
        : 'throw __error;'
    }
  }

  var sortedNodeIds = nodes.slice().sort(function(a, b) { return a.stepNumber - b.stepNumber; }).map(function(n) { return n.id; });
  var lastNodeId = null;
  for (var __ri = sortedNodeIds.length - 1; __ri >= 0; __ri--) {
    if (context[sortedNodeIds[__ri]] !== undefined) { lastNodeId = sortedNodeIds[__ri]; break; }
  }
  return lastNodeId ? context[lastNodeId] : {};
}`)
      } else {
        // No server segments — simple client-only execution
        functions.push(`
// Custom workflow node: ${cn.name || id}
// ${cn.description || ''}
// Parameters: ${params.join(', ')}
async function customNode_${safeId}(outerContext, parameters, nodeHandlers) {
  var nodes = ${nodesJson};
  var edges = ${edgesJson};
  var context = Object.assign({}, outerContext);
  context.__customParams = parameters;
  context.__isInsideCustomNode = true;
  var nodeIds = nodes.map(function(n) { return n.id; });
  context.__customNodeIds = nodeIds;
  context.__previousNodeResult = null;

  var wfConfig = { customNodes: __customNodeRegistry${
    errorHandlerNodeId
      ? `, nodes: nodes, edges: edges, errorHandlerNodeId: '${errorHandlerNodeId}'`
      : ''
  } };
  var executionId = Date.now().toString();
  try {
    await __utils.executeNodes(nodes, edges, context, nodeHandlers, wfConfig, null, executionId);
  } catch (__error) {
    if (__error && (__error.__skipErrorHandler || __error.__rateLimited)) {
      throw __error;
    }
    ${
      errorHandlerNodeId
        ? `var __firstErrorEdge = edges.filter(function(e) { return e.source === '${errorHandlerNodeId}'; })[0];
    if (__firstErrorEdge) {
      var __errorNodes = __utils.collectBranchNodes(__firstErrorEdge.target, nodes, edges, '${errorHandlerNodeId}');
      if (__errorNodes.length > 0) {
        context['${errorHandlerNodeId}'] = {
          error: { message: (__error && __error.message) || String(__error), stack: (__error && __error.stack) || '' },
          errorMessage: (__error && __error.message) || String(__error)
        };
        try {
          await __utils.executeNodes(__errorNodes, edges, context, nodeHandlers, wfConfig, null, executionId);
        } catch (__innerErr) {
          console.error('Custom workflow node error handler failed:', __innerErr);
        }
      } else {
        throw __error;
      }
    } else {
      throw __error;
    }`
        : 'throw __error;'
    }
  }

  var sortedNodeIds = nodes.slice().sort(function(a, b) { return a.stepNumber - b.stepNumber; }).map(function(n) { return n.id; });
  var lastNodeId = null;
  for (var __ri = sortedNodeIds.length - 1; __ri >= 0; __ri--) {
    if (context[sortedNodeIds[__ri]] !== undefined) { lastNodeId = sortedNodeIds[__ri]; break; }
  }
  return lastNodeId ? context[lastNodeId] : {};
}`)
      }
    }

    const hasAnyServerSegments = Object.keys(customNodeServerUrls).length > 0
    const registryEntries = Object.keys(customNodes)
      .map(
        (id) => `__customNodeRegistry['${id}'] = customNode_${id.replace(/[^a-zA-Z0-9]/g, '_')};`
      )
      .join('\n')

    return `// Auto-generated custom workflow nodes
var __utils = require('./runtime-utils');
${hasAnyServerSegments ? "var __runtime = require('./runtime');" : ''}

var __customNodeRegistry = {};
${functions.join('\n')}

${registryEntries}

module.exports = __customNodeRegistry;
`
  }

  private generateAuthFiles(auth: UIDLAuthentication, structure: ProjectPluginStructure): void {
    const { files, dependencies, uidl } = structure

    const dataSourceConfig =
      (auth.dataSourceId && uidl.dataSources?.[auth.dataSourceId]?.config) || null
    const authOptionsCode = generateAuthOptionsFile(auth, dataSourceConfig)
    files.set('auth-options', {
      path: ['utils', 'auth'],
      files: [
        {
          name: 'auth-options',
          fileType: FileType.JS,
          content: authOptionsCode,
        },
      ],
    })

    if (auth.passwordAuthEnabled) {
      const hashPasswordCode = generateHashPasswordFile()
      files.set('auth-hash-password', {
        path: ['utils', 'auth'],
        files: [
          {
            name: 'hash-password',
            fileType: FileType.JS,
            content: hashPasswordCode,
          },
        ],
      })

      const signupRouteCode = generateSignupRouteFile(auth)
      files.set('auth-signup-route', {
        path: ['pages', 'api', 'auth'],
        files: [
          {
            name: 'signup',
            fileType: FileType.JS,
            content: signupRouteCode,
          },
        ],
      })
    }

    const nextAuthRouteCode = generateNextAuthRouteFile()
    files.set('auth-nextauth-route', {
      path: ['pages', 'api', 'auth'],
      files: [
        {
          name: '[...nextauth]',
          fileType: FileType.JS,
          content: nextAuthRouteCode,
        },
      ],
    })

    const hasProtectedRoutes =
      (auth.pageProtection && Object.keys(auth.pageProtection).length > 0) ||
      (auth.folderProtection && Object.keys(auth.folderProtection).length > 0)

    if (hasProtectedRoutes) {
      const middlewareCode = generateMiddlewareFile(auth)
      files.set('auth-middleware', {
        path: [],
        files: [
          {
            name: 'middleware',
            fileType: FileType.JS,
            content: middlewareCode,
          },
        ],
      })
    }

    const sessionProviderCode = generateSessionProviderWrapper()
    files.set('auth-session-provider', {
      path: ['utils', 'auth'],
      files: [
        {
          name: 'session-provider',
          fileType: FileType.JS,
          content: sessionProviderCode,
        },
      ],
    })

    dependencies['next-auth'] = '^4.24.0'
    dependencies.bcryptjs = '^2.4.3'

    const driverDeps = getDatabaseDriverDependencies(auth.dataSourceType)
    for (const [pkg, version] of Object.entries(driverDeps)) {
      if (!dependencies[pkg]) {
        dependencies[pkg] = version
      }
    }

    if (auth.envKeys) {
      if (!uidl.globals.env) {
        uidl.globals.env = {}
      }
      const oauthCredentialKeys = collectOAuthCredentialEnvKeys(auth)
      for (const [key, value] of Object.entries(auth.envKeys)) {
        if (!uidl.globals.env[key]) {
          uidl.globals.env[key] = resolveAuthEnvValue(key, String(value), oauthCredentialKeys)
        }
      }
    }
  }

  private injectSessionProviderIntoApp(structure: ProjectPluginStructure): void {
    const { files } = structure

    // Find the _app file in the files Map
    let appFileRecord: any = null
    let appFile: any = null

    for (const [key, record] of files.entries()) {
      if (key === '_app' || key.includes('_app')) {
        appFileRecord = record
        appFile = record.files?.find(
          (f: any) => f.name === '_app' && (f.fileType === 'js' || f.fileType === 'tsx')
        )
        if (appFile) {
          break
        }
      }
    }

    if (!appFile || typeof appFile.content !== 'string') {
      return
    }

    if (
      appFile.content.includes('AuthSessionProvider') ||
      appFile.content.includes('SessionProvider')
    ) {
      return
    }

    let content = appFile.content

    const sessionImport = `import AuthSessionProvider from '../utils/auth/session-provider';\n`
    const firstImportIdx = content.indexOf('import ')
    if (firstImportIdx >= 0) {
      content = content.slice(0, firstImportIdx) + sessionImport + content.slice(firstImportIdx)
    } else {
      content = sessionImport + content
    }

    const returnMatch = content.match(/return\s*\(\s*/)
    if (returnMatch && returnMatch.index !== undefined) {
      const afterReturn = returnMatch.index + returnMatch[0].length
      const restContent = content.slice(afterReturn)
      const closingParenIdx = findMatchingClosingParen(restContent)
      if (closingParenIdx >= 0) {
        const innerJSX = restContent.slice(0, closingParenIdx)
        const afterClosing = restContent.slice(closingParenIdx)
        content =
          content.slice(0, afterReturn) +
          `<AuthSessionProvider pageProps={pageProps}>${innerJSX}</AuthSessionProvider>` +
          afterClosing
      }
    } else {
      const returnSimpleMatch = content.match(/return\s+(<[^;]+);?/)
      if (returnSimpleMatch && returnSimpleMatch.index !== undefined) {
        const returnStart = returnSimpleMatch.index
        const returnKeyword = content.slice(returnStart, returnStart + 7)
        const jsx = returnSimpleMatch[1]
        content =
          content.slice(0, returnStart) +
          `${returnKeyword}<AuthSessionProvider pageProps={pageProps}>${jsx}</AuthSessionProvider>` +
          content.slice(returnStart + returnSimpleMatch[0].length)
      }
    }

    appFile.content = content
  }

  private generateGlobalWorkflowsHook(workflows: any[]): string {
    const registrations: string[] = []
    const handlerTypes = new Set<string>()

    for (const wf of workflows) {
      const segments = splitIntoSegments(wf)
      wf.nodes.forEach((n: any) => {
        const seg = segments.find((s: any) => s.nodeIds.includes(n.id))
        if (seg && seg.env === 'client') {
          handlerTypes.add(n.type)
        }
      })

      const safeId = wf.id.replace(/[^a-zA-Z0-9]/g, '_')
      const trigger = wf.trigger

      if (trigger.type === 'event-unhandled-error') {
        registrations.push(`
    const handler_${safeId} = function(event) {
      const ctx = { message: event.message, stack: event.error ? event.error.stack : '', filename: event.filename, lineno: event.lineno, colno: event.colno };
      executeWorkflow_${safeId}(ctx).catch(function() {});
    };
    window.addEventListener('error', handler_${safeId});
    cleanups.push(function() { window.removeEventListener('error', handler_${safeId}); });`)
      } else if (trigger.type === 'event-custom-triggered') {
        const eventName = trigger.config.eventName as string
        registrations.push(`
    const handler_${safeId} = function(event) {
      const ctx = { eventName: '${eventName}', eventData: event.detail, timestamp: Date.now() };
      executeWorkflow_${safeId}(ctx).catch(function() {});
    };
    window.addEventListener('workflow:custom:${eventName}', handler_${safeId});
    cleanups.push(function() { window.removeEventListener('workflow:custom:${eventName}', handler_${safeId}); });`)
      } else if (trigger.type === 'event-user-logged-in') {
        registrations.push(`
    const handler_${safeId} = function(event) {
      const ctx = event.detail || { timestamp: Date.now() };
      executeWorkflow_${safeId}(ctx).catch(function() {});
    };
    window.addEventListener('workflow:user-logged-in', handler_${safeId});
    cleanups.push(function() { window.removeEventListener('workflow:user-logged-in', handler_${safeId}); });`)
      } else if (trigger.type === 'event-user-logged-out') {
        registrations.push(`
    const handler_${safeId} = function(event) {
      const ctx = event.detail || { timestamp: Date.now() };
      executeWorkflow_${safeId}(ctx).catch(function() {});
    };
    window.addEventListener('workflow:user-logged-out', handler_${safeId});
    cleanups.push(function() { window.removeEventListener('workflow:user-logged-out', handler_${safeId}); });`)
      }
    }

    const handlers: string[] = []
    handlerTypes.forEach((t) => {
      const gen = nodeRegistry[t]
      if (gen) {
        handlers.push(gen.generateHandler())
      }
    })

    const handlerEntries = Array.from(handlerTypes)
      .map((t) => `    '${t}': ${t.replace(/-/g, '_')}`)
      .join(',\n')

    // NOTE: this module is pulled into the GLOBAL client bundle (every page,
    // via `useGlobalWorkflows()` in _app). It must use a single module system.
    // It previously mixed ESM `import`/`export` with a CommonJS
    // `require('./runtime')` in the same file; under SWC's production
    // minify+chunk-split that mix can emit a module reference whose factory is
    // undefined, so `__webpack_require__` hits `undefined.call` — the Vercel-
    // only "Cannot read properties of undefined (reading 'call')" crash. Using
    // a static ESM default import of the (CommonJS) runtime keeps the file
    // pure-ESM; SWC interop resolves the default to `module.exports`.
    return `// Auto-generated global workflow hooks
import { useEffect } from 'react';
import workflowRuntime from './runtime';
const executeWorkflowWithSegments = workflowRuntime.executeWorkflowWithSegments;

export function useGlobalWorkflows() {
${handlers.join('\n')}

  const clientNodeHandlers = {
${handlerEntries}
  };

${workflows
  .map((wf) => {
    const safeId = wf.id.replace(/[^a-zA-Z0-9]/g, '_')
    const segments = splitIntoSegments(wf)
    const serverSegments = segments.filter((s: any) => s.env === 'server')
    const serverUrls: Record<string, string> = {}
    serverSegments.forEach((seg: any) => {
      serverUrls[seg.id] = `/api/workflows/${getAPIRouteFileName(wf.id, seg.id, wf.name)}`
    })

    return `  const executeWorkflow_${safeId} = async function(triggerContext) {
    const wfConfig = {
      triggerNodeId: '${wf.trigger.nodeId}',
      segments: ${JSON.stringify(
        segments.map((s: any) => ({
          id: s.id,
          env: s.env,
          hasStreamingAI: hasStreamingAINode(s),
          nodes: s.nodes.map((n: any) => ({
            id: n.id,
            type: n.type,
            config: n.config,
            stepNumber: n.stepNumber,
          })),
          edges: s.edges,
        }))
      )},
      ${wf.errorHandler ? `errorHandlerNodeId: '${wf.errorHandler.nodeId}',` : ''}
      nodes: ${JSON.stringify(
        wf.nodes.map((n: any) => ({
          id: n.id,
          type: n.type,
          config: n.config,
          stepNumber: n.stepNumber,
        }))
      )},
      edges: ${JSON.stringify(wf.edges)}
    };
    return executeWorkflowWithSegments(wfConfig, triggerContext, clientNodeHandlers, ${JSON.stringify(
      serverUrls
    )});
  };`
  })
  .join('\n')}

  useEffect(function() {
    const cleanups = [];
${registrations.join('\n')}
    return function() { cleanups.forEach(function(fn) { fn(); }); };
  }, []);
}
`
  }
}

const AUTH_ENV_DEFAULTS: Record<string, string> = {
  NEXTAUTH_URL: 'http://localhost:3000',
  NEXTAUTH_SECRET: 'CHANGE_ME_TO_A_RANDOM_SECRET',
}

// The two stable CMS env keys (teleport-gui's CMS_ENV_URL / CMS_ENV_ACCESS_TOKEN).
// Their `teleporthq.secrets.<name>` placeholder MUST survive to the deployed env
// so the deploy worker can resolve it — for the same reason OAuth credential
// keys are preserved. These are ALIASES: the env KEY differs from the secret
// name it references, e.g.
//   Contentful: CMS_ACCESS_TOKEN=teleporthq.secrets.CONTENTFUL_API_TOKEN2
//               (CMS_URL is a plain delivery-API URL, not a secret ref)
//   Strapi:     CMS_URL=teleporthq.secrets.STRAPI_URL
//               CMS_ACCESS_TOKEN=teleporthq.secrets.STRAPI_ACCESS_TOKEN
// The worker's `replaceSecretsFromEnvFile` empty-value fallback only refills a
// blank line by looking up a secret named exactly after the KEY (CMS_URL /
// CMS_ACCESS_TOKEN), which does not exist — only the referenced name
// (STRAPI_URL / CONTENTFUL_API_TOKEN2 / …) does. So emptying an alias is
// unrecoverable: the CMS base URL and/or token ship blank, and every CMS fetch
// on the deployed site fails (empty CMS_URL → hostless `/api/...` fetch; empty
// token → 401). The list renders in the GUI but is empty in the deployed
// project. Keeping the placeholder lets the worker resolve it via its
// `teleporthq.secrets.*` branch. (For values that are NOT secret refs — e.g. the
// Contentful CMS_URL — resolveAuthEnvValue passes them through untouched, so
// listing CMS_URL here is a no-op in that case.)
const ALWAYS_PRESERVE_SECRET_ENV_KEYS = new Set(['CMS_URL', 'CMS_ACCESS_TOKEN'])

// Every env key that holds an OAuth provider credential (e.g. AUTH_GOOGLE_ID,
// AUTH_GOOGLE_SECRET, AUTH_AUTH0_ISSUER). These are the keys in each configured
// provider's `credentials` map. The user's typed values are stored in the
// project secret store; the deployed env must keep the
// `teleporthq.secrets.<key>` placeholder so the deploy worker can inject the
// real value. (Everything else here is handled by other plugins / the worker.)
export function collectOAuthCredentialEnvKeys(auth: UIDLAuthentication | undefined): Set<string> {
  const keys = new Set<string>()
  const providers = auth && Array.isArray(auth.providers) ? auth.providers : []
  for (const provider of providers) {
    const creds = provider && provider.credentials
    if (creds && typeof creds === 'object') {
      for (const k of Object.keys(creds)) {
        keys.add(k)
      }
    }
  }
  return keys
}

export function resolveAuthEnvValue(
  key: string,
  value: string,
  preserveKeys?: Set<string>
): string {
  if (value.startsWith('teleporthq.secrets.')) {
    // NEXTAUTH_URL / NEXTAUTH_SECRET get a local default (the worker does not
    // manage them). OAuth provider credential refs are PRESERVED so the deploy
    // worker resolves them from the project secret store — emptying them (the
    // old behavior) left the deployed env var blank, so NextAuth could not build
    // the provider's authorization URL (error=OAuthSignin / "nothing happens").
    if (Object.prototype.hasOwnProperty.call(AUTH_ENV_DEFAULTS, key)) {
      return AUTH_ENV_DEFAULTS[key]
    }
    if (ALWAYS_PRESERVE_SECRET_ENV_KEYS.has(key)) {
      return value
    }
    if (preserveKeys && preserveKeys.has(key)) {
      return value
    }
    return ''
  }
  return value
}

function findMatchingClosingParen(str: string): number {
  let depth = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '(') {
      depth++
    }
    if (ch === ')') {
      if (depth === 0) {
        return i
      }
      depth--
    }
  }
  return -1
}
