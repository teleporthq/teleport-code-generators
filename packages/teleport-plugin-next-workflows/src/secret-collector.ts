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
