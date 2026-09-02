import {
  FileType,
  ProjectPlugin,
  ProjectPluginStructure,
  UIDLAIAssistantChat,
} from '@teleporthq/teleport-types'
import { generateDBConnectionCode, getDBDependencies } from './db-generator'
import { generateProviderCode, getProviderDependencies } from './provider-generator'
import {
  generateMessageRouteCode,
  generateConversationsRouteCode,
  generateConversationByIdRouteCode,
  generateConversationMessagesRouteCode,
} from './api-route-generator'
import { generateHookCode } from './hook-generator'
import {
  generateWidgetCode,
  generateBubbleCode,
  generateWindowCode,
  generateMessageCode,
  generateGlobalCSSCode,
} from './widget-generator'
import { generateAuthWrapperCode } from './auth-wrapper-generator'
import {
  AI_CHAT_LOCALIZED_MESSAGES_FILE,
  AI_CHAT_LOCALIZED_MESSAGES_PATH,
  generateLocalizedMessagesCode,
} from './localized-messages'
import { AI_CHAT_SESSION_STORE_FILE, generateAIChatSessionStoreCode } from './session-store'
import { injectImportIntoApp } from '../app-import-injection'
import { emitLegacyPeerDepsNpmrc } from '../npmrc-legacy-peer-deps'

export class NextAIChatProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files, dependencies } = structure
    const chat = uidl.aiAssistantChat
    if (!chat || !chat.enabled) {
      return structure
    }

    // If the UIDL already defines an ai-assistant-chat component (which renders
    // its own chat UI using workflows), skip generating the plugin-level widget
    // and injecting it into _app.js to avoid duplicate chat bubbles on the page.
    const hasUIDLChatComponent =
      uidl.components &&
      Object.keys(uidl.components).some(
        (key) => key === 'ai-assistant-chat' || key === 'AiAssistantChat'
      )

    const dataSource = this.resolveDataSource(uidl, chat)

    this.generateLibFiles(files, chat, dataSource)
    this.generateAPIRoutes(files, chat)
    this.generateHookFile(files, chat)
    if (!hasUIDLChatComponent) {
      this.generateWidgetFiles(files, chat)
      if (chat.authProtection?.requiresAuth) {
        this.generateAuthWrapperFile(files, chat.authProtection)
      }
      this.generateStylesFile(files)
    }
    this.addDependencies(dependencies, chat, dataSource)
    // react-markdown@9 (added by addDependencies for rendering assistant replies)
    // declares `peer react@>=18`, so a project that enables AI chat but uses none
    // of the other React-18 widgets (calendar/kanban/motion) would keep the
    // template's react@^17 and fail `npm i` with ERESOLVE. Bump react/react-dom to
    // ^18 and emit the legacy-peer-deps .npmrc — mirroring the calendar/kanban
    // plugins so all React-18 bump sites stay consistent.
    dependencies.react = '^18.3.1'
    dependencies['react-dom'] = '^18.3.1'
    emitLegacyPeerDepsNpmrc(structure, 'ai-chat-npmrc')
    this.addEnvVariables(uidl, chat)
    // Side-effect import: the store drops a stored conversation when the
    // document was RELOADED. It has to run on every page, not only the ones
    // carrying the chat — a refresh on a chat-less page would otherwise leave
    // the transcript in storage for the next chat page to restore, and the
    // conversation would outlive the refresh that was meant to end it.
    injectImportIntoApp(structure, `import '../lib/ai-chat/${AI_CHAT_SESSION_STORE_FILE}'`)
    if (!hasUIDLChatComponent) {
      this.injectWidgetIntoApp(structure)
    }

    return structure
  }

  private resolveDataSource(
    uidl: ProjectPluginStructure['uidl'],
    chat: UIDLAIAssistantChat
  ): { type: string; config: Record<string, unknown> } | null {
    if (!chat.dataSourceId || !uidl.dataSources) {
      return null
    }
    const ds = uidl.dataSources[chat.dataSourceId]
    if (!ds) {
      return null
    }
    return { type: ds.type, config: ds.config }
  }

  private generateLibFiles(
    files: ProjectPluginStructure['files'],
    chat: UIDLAIAssistantChat,
    dataSource: { type: string; config: Record<string, unknown> } | null
  ): void {
    files.set('ai-chat-db', {
      path: ['lib', 'ai-chat'],
      files: [
        {
          name: 'db',
          fileType: FileType.JS,
          content: generateDBConnectionCode(dataSource),
        },
      ],
    })

    files.set('ai-chat-provider', {
      path: ['lib', 'ai-chat'],
      files: [
        {
          name: 'provider',
          fileType: FileType.JS,
          content: generateProviderCode(chat),
        },
      ],
    })

    // Emitted for every chat, single-language included: the hook, the API route
    // and the chat component all resolve their copy through it, so having it
    // unconditionally keeps those three free of "does this project have
    // languages?" branches. It is one small map on a single-language project.
    files.set('ai-chat-localized-messages', {
      path: AI_CHAT_LOCALIZED_MESSAGES_PATH,
      files: [
        {
          name: AI_CHAT_LOCALIZED_MESSAGES_FILE,
          fileType: FileType.JS,
          content: generateLocalizedMessagesCode(chat),
        },
      ],
    })

    // Holds the conversation while the visitor moves between pages — the chat
    // is mounted per page, so without it a link click ends the conversation.
    files.set('ai-chat-session-store', {
      path: AI_CHAT_LOCALIZED_MESSAGES_PATH,
      files: [
        {
          name: AI_CHAT_SESSION_STORE_FILE,
          fileType: FileType.JS,
          content: generateAIChatSessionStoreCode(),
        },
      ],
    })
  }

  private generateAPIRoutes(
    files: ProjectPluginStructure['files'],
    chat: UIDLAIAssistantChat
  ): void {
    files.set('ai-chat-api-message', {
      path: ['pages', 'api', 'ai-chat'],
      files: [
        {
          name: 'message',
          fileType: FileType.JS,
          content: generateMessageRouteCode(chat),
        },
      ],
    })

    files.set('ai-chat-api-conversations', {
      path: ['pages', 'api', 'ai-chat', 'conversations'],
      files: [
        {
          name: 'index',
          fileType: FileType.JS,
          content: generateConversationsRouteCode(chat),
        },
      ],
    })

    files.set('ai-chat-api-conversation-by-id', {
      path: ['pages', 'api', 'ai-chat', 'conversations'],
      files: [
        {
          name: '[id]',
          fileType: FileType.JS,
          content: generateConversationByIdRouteCode(chat),
        },
      ],
    })

    files.set('ai-chat-api-conversation-messages', {
      path: ['pages', 'api', 'ai-chat', 'conversations', '[id]'],
      files: [
        {
          name: 'messages',
          fileType: FileType.JS,
          content: generateConversationMessagesRouteCode(chat),
        },
      ],
    })
  }

  private generateHookFile(
    files: ProjectPluginStructure['files'],
    chat: UIDLAIAssistantChat
  ): void {
    files.set('ai-chat-hook', {
      path: ['hooks'],
      files: [
        {
          name: 'useAIChat',
          fileType: FileType.JS,
          content: generateHookCode(chat),
        },
      ],
    })
  }

  private generateWidgetFiles(
    files: ProjectPluginStructure['files'],
    chat: UIDLAIAssistantChat
  ): void {
    files.set('ai-chat-widget', {
      path: ['components', 'ai-chat'],
      files: [
        {
          name: 'AIChatWidget',
          fileType: FileType.JS,
          content: generateWidgetCode(chat),
        },
      ],
    })

    files.set('ai-chat-bubble', {
      path: ['components', 'ai-chat'],
      files: [
        {
          name: 'AIChatBubble',
          fileType: FileType.JS,
          content: generateBubbleCode(chat),
        },
      ],
    })

    files.set('ai-chat-window', {
      path: ['components', 'ai-chat'],
      files: [
        {
          name: 'AIChatWindow',
          fileType: FileType.JS,
          content: generateWindowCode(chat),
        },
      ],
    })

    files.set('ai-chat-message', {
      path: ['components', 'ai-chat'],
      files: [
        {
          name: 'AIChatMessage',
          fileType: FileType.JS,
          content: generateMessageCode(chat),
        },
      ],
    })
  }

  private generateAuthWrapperFile(
    files: ProjectPluginStructure['files'],
    authProtection: NonNullable<UIDLAIAssistantChat['authProtection']>
  ): void {
    files.set('ai-chat-auth-wrapper', {
      path: ['components', 'ai-chat'],
      files: [
        {
          name: 'AIChatWrapper',
          fileType: FileType.JS,
          content: generateAuthWrapperCode(authProtection),
        },
      ],
    })
  }

  private generateStylesFile(files: ProjectPluginStructure['files']): void {
    files.set('ai-chat-styles', {
      path: ['styles'],
      files: [
        {
          name: 'ai-chat',
          fileType: FileType.CSS,
          content: generateGlobalCSSCode(),
        },
      ],
    })
  }

  private addDependencies(
    dependencies: Record<string, string>,
    chat: UIDLAIAssistantChat,
    dataSource: { type: string; config: Record<string, unknown> } | null
  ): void {
    const provider = chat.aiProvider?.provider || 'openai'
    const providerDeps = getProviderDependencies(provider)
    for (const [pkg, version] of Object.entries(providerDeps)) {
      if (!dependencies[pkg]) {
        dependencies[pkg] = version
      }
    }

    const dbDeps = getDBDependencies(dataSource)
    for (const [pkg, version] of Object.entries(dbDeps)) {
      if (!dependencies[pkg]) {
        dependencies[pkg] = version
      }
    }

    if (!dependencies['react-markdown']) {
      dependencies['react-markdown'] = '^9.0.0'
    }
    if (!dependencies['remark-gfm']) {
      dependencies['remark-gfm'] = '^4.0.0'
    }
  }

  private addEnvVariables(uidl: ProjectPluginStructure['uidl'], chat: UIDLAIAssistantChat): void {
    if (!uidl.globals.env) {
      uidl.globals.env = {}
    }

    if (chat.aiProvider?.secretKeyReference) {
      const key = chat.aiProvider.secretKeyReference
      if (!uidl.globals.env[key]) {
        uidl.globals.env[key] = ''
      }
    }

    // The embedding key is its own env var, and is needed by EVERY non-OpenAI
    // provider — not just Anthropic. Embeddings always go to OpenAI because
    // that is what the knowledge base was indexed with, so a Google/Cohere/
    // Mistral/Llama chat still needs an OpenAI key for semantic search.
    const provider = chat.aiProvider?.provider || 'openai'
    if (provider !== 'openai') {
      const embeddingKey = chat.aiProvider?.embeddingSecretKeyReference
      if (embeddingKey && !uidl.globals.env[embeddingKey]) {
        uidl.globals.env[embeddingKey] = ''
      }
      // Always surfaced as the documented override, so the key can be supplied
      // at deploy time even when the project has no OpenAI secret recorded.
      if (!uidl.globals.env.EMBEDDING_API_KEY) {
        uidl.globals.env.EMBEDDING_API_KEY = ''
      }
    }
  }

  private injectWidgetIntoApp(structure: ProjectPluginStructure): void {
    const { files, uidl } = structure
    const chat = uidl.aiAssistantChat

    let appFile: any = null
    for (const [key, record] of Array.from(files.entries())) {
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
    if (appFile.content.includes('AIChatWidget') || appFile.content.includes('AIChatWrapper')) {
      return
    }

    const useAuthWrapper = !!chat?.authProtection?.requiresAuth
    const componentName = useAuthWrapper ? 'AIChatWrapper' : 'AIChatWidget'

    let content = appFile.content

    const widgetImport = `import ${componentName} from '../components/ai-chat/${componentName}';\nimport '../styles/ai-chat.css';\n`
    const firstImportIdx = content.indexOf('import ')
    if (firstImportIdx >= 0) {
      content = content.slice(0, firstImportIdx) + widgetImport + content.slice(firstImportIdx)
    } else {
      content = widgetImport + content
    }

    const returnMatch = content.match(/return\s*\(\s*/)
    if (returnMatch && returnMatch.index !== undefined) {
      const afterReturn = returnMatch.index + returnMatch[0].length
      const restContent = content.slice(afterReturn)
      const closingParenIdx = findMatchingClosingParen(restContent)
      if (closingParenIdx >= 0) {
        const innerJSX = restContent.slice(0, closingParenIdx)
        const afterClosing = restContent.slice(closingParenIdx)
        // Wrap inner JSX in a fragment so the widget becomes a sibling of the
        // existing top-level element. Both halves of the fragment are required —
        // omitting `</>` produces a syntax error in _app.js.
        content =
          content.slice(0, afterReturn) + `<>${innerJSX}<${componentName} /></>` + afterClosing
      }
    }

    appFile.content = content
  }
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
