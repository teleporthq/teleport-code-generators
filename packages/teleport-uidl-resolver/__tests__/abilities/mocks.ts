import {
  UIDLNavLinkNode,
  UIDLURLLinkNode,
  UIDLMailLinkNode,
  UIDLPhoneLinkNode,
  UIDLSectionLinkNode,
} from '@teleporthq/teleport-types'
import { staticNode } from '@teleporthq/teleport-uidl-builders'

export const urlMockedDefinition = (openInNewTab: boolean = false): UIDLURLLinkNode => ({
  type: 'url',
  content: {
    url: staticNode('https://teleporthq.io'),
    newTab: openInNewTab,
  },
})

export const navlinkMockedDefinition = (): UIDLNavLinkNode => ({
  type: 'navlink',
  content: {
    routeName: 'home',
  },
})

export const phoneMockedDefinition = (): UIDLPhoneLinkNode => ({
  type: 'phone',
  content: {
    phone: '091837864834',
  },
})

export const sectionMockedDefinition = (): UIDLSectionLinkNode => ({
  type: 'section',
  content: {
    id: 'contact',
  },
})

export const mailMockedDefinition = (): UIDLMailLinkNode => ({
  type: 'mail',
  content: {
    mail: 'test@teleporthq.io',
    subject: 'Hello',
    body: "Is it me you're looking for?",
  },
})
