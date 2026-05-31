import { UIDLWorkflows, UIDLWorkflowNode, UIDLCustomWorkflowNode } from '@teleporthq/teleport-types'
import { SecretEntry } from './types'
import { nodeRegistry } from './nodes'

const KNOWN_SECRET_FIELDS: Record<string, string[]> = {
  'ai-custom-prompt': ['token'],
  'ai-sentiment-analysis': ['token'],
  'ai-summarization': ['token'],
  'ai-text-classifier': ['token'],
  'ai-text-transform': ['token'],
  'ai-detect-language': ['token'],
  'ai-generate-text-embedding': ['token'],
  'email-mailersend': ['apiKey'],
  'email-mailgun': ['apiKey'],
  'email-postmark': ['serverToken'],
  'email-resend': ['apiKey'],
  'email-sendgrid': ['apiKey'],
  'sms-textmagic': ['apiKey'],
  'sms-infobip': ['apiKey'],
  'sms-twilio': ['accountSid', 'authToken'],
  'sms-smsapi': ['accessToken'],
  'general-http-request': [],
  'payment-charge-user': ['secretKey', 'clientId', 'clientSecret'],
  'payment-subscribe-to-plan': ['secretKey'],
  'payment-cancel-plan': ['secretKey'],
  'payment-create-customer': ['secretKey', 'clientId', 'clientSecret'],
  'payment-create-product': ['secretKey'],
  'payment-create-subscription': ['secretKey'],
  'payment-get-customer': ['secretKey'],
  'payment-get-product': ['secretKey'],
  'payment-list-customers': ['secretKey'],
  'payment-list-plans': ['secretKey'],
  'payment-list-products': ['secretKey'],
  'payment-list-subscriptions': ['secretKey'],
  'payment-update-customer': ['secretKey'],
}

export const collectSecrets = (workflows: UIDLWorkflows): SecretEntry[] => {
  const secrets: SecretEntry[] = []
  const seenEnvVars = new Set<string>()

  const processNode = (node: UIDLWorkflowNode) => {
    const secretFields = getSecretFieldsForNode(node.type)
    for (const field of secretFields) {
      const value = node.config[field]
      if (value && typeof value === 'string' && !isWorkflowContextValue(value)) {
        const envVarName = generateEnvVarName(node.type, field, node.id)
        if (!seenEnvVars.has(envVarName)) {
          seenEnvVars.add(envVarName)
          secrets.push({
            envVarName,
            value: value as string,
            nodeId: node.id,
            fieldName: field,
          })
        }
      }
    }
  }

  const allWorkflows = workflows.workflows as Record<string, { nodes: UIDLWorkflowNode[] }>
  Object.values(allWorkflows).forEach((wf) => {
    wf.nodes.forEach(processNode)
  })

  if (workflows.customNodes) {
    Object.values(workflows.customNodes).forEach((cn: UIDLCustomWorkflowNode) => {
      cn.nodes.forEach(processNode)
    })
  }

  return secrets
}

const getSecretFieldsForNode = (nodeType: string): string[] => {
  if (KNOWN_SECRET_FIELDS[nodeType]) {
    return KNOWN_SECRET_FIELDS[nodeType]
  }

  if (nodeType.startsWith('integration-')) {
    const generator = nodeRegistry[nodeType]
    if (generator && 'secretFields' in generator) {
      return (generator as any).secretFields || []
    }
    return ['token', 'apiKey', 'accessToken', 'secretKey']
  }

  return []
}

const generateEnvVarName = (nodeType: string, fieldName: string, nodeId: string): string => {
  const prefix = 'WORKFLOW_SECRET'
  const typePart = nodeType.replace(/-/g, '_').toUpperCase()
  const fieldPart = fieldName.replace(/([A-Z])/g, '_$1').toUpperCase()
  const idPart = nodeId
    .replace(/[^a-zA-Z0-9]/g, '_')
    .substring(0, 8)
    .toUpperCase()
  return `${prefix}_${typePart}_${fieldPart}_${idPart}`
}

const isWorkflowContextValue = (value: unknown): boolean => {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).type === 'workflowContext'
  )
}

export const replaceSecretsInConfig = (
  config: Record<string, unknown>,
  nodeType: string,
  nodeId: string,
  secrets: SecretEntry[]
): Record<string, unknown> => {
  const result = { ...config }
  const secretFields = getSecretFieldsForNode(nodeType)

  for (const field of secretFields) {
    const secret = secrets.find((s) => s.nodeId === nodeId && s.fieldName === field)
    if (secret) {
      result[field] = secret.envVarName
    }
  }

  return result
}

// The builder stores node-config credentials (SMS/AI/integration/email keys,
// etc.) in the project secret store and replaces the config field with a
// reference object: { type: 'dynamic', content: { referenceType: 'secret',
// id: '<STORE_KEY>' } }. `collectSecrets` above only captures inline STRING
// secrets, so these references are otherwise dropped from the generated .env
// entirely and never reach Vercel. This walks every node config (recursively,
// incl. custom nodes and nested objects/arrays) and returns the set of store
// keys, so the project plugin can pre-register each as a
// `teleporthq.secrets.<KEY>` placeholder that the deploy step resolves.
const isSecretReferenceObject = (value: unknown): value is { content: { id: string } } => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const v = value as { type?: unknown; content?: { referenceType?: unknown; id?: unknown } }
  return (
    v.type === 'dynamic' &&
    !!v.content &&
    v.content.referenceType === 'secret' &&
    typeof v.content.id === 'string'
  )
}

export const collectSecretReferenceEnvNames = (workflows: UIDLWorkflows): string[] => {
  const names = new Set<string>()
  if (!workflows || typeof workflows !== 'object') {
    return []
  }

  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') {
      return
    }
    if (isSecretReferenceObject(value)) {
      names.add(value.content.id)
      return
    }
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    Object.values(value as Record<string, unknown>).forEach(walk)
  }

  const processNode = (node: UIDLWorkflowNode) => {
    if (node && node.config) {
      walk(node.config)
    }
  }

  const allWorkflows = (workflows.workflows || {}) as Record<string, { nodes?: UIDLWorkflowNode[] }>
  Object.values(allWorkflows).forEach((wf) => {
    if (wf && Array.isArray(wf.nodes)) {
      wf.nodes.forEach(processNode)
    }
  })

  const customNodes = (workflows.customNodes || {}) as Record<string, UIDLCustomWorkflowNode>
  Object.values(customNodes).forEach((cn) => {
    const cnNodes = cn && (cn as unknown as { nodes?: UIDLWorkflowNode[] }).nodes
    if (Array.isArray(cnNodes)) {
      cnNodes.forEach(processNode)
    }
  })

  return Array.from(names)
}
