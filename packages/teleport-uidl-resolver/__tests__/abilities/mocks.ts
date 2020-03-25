import {
  UIDLLinkDefinition,
  UIDLNavLinkDefinition,
  UIDLLinkPhoneDefinition,
  UIDLLinkMailDefinition,
} from '@teleporthq/teleport-types'
import { staticNode } from '@teleporthq/teleport-uidl-builders'

export const urlMockedDefinition = (openInNewTab: boolean = false): UIDLLinkDefinition => ({
  type: 'url',
  options: {
    url: staticNode('https://teleporthq.io'),
    newTab: openInNewTab,
  },
})

export const navlinkMockedDefinition = (): UIDLNavLinkDefinition => ({
  type: 'navlink',
  options: {
    routeName: 'home',
  },
})

export const phoneMockedDefinition = (): UIDLLinkPhoneDefinition => ({
  type: 'phone',
  options: {
    phone: '091837864834',
  },
})

export const mailMockedDefinition = (): UIDLLinkMailDefinition => ({
  type: 'mail',
  options: {
    mail: 'test@teleporthq.io',
    subject: 'Hello',
    body: "Is it me you're looking for?",
  },
})
