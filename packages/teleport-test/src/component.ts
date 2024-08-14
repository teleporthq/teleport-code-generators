import { join } from 'path'
import { writeFile } from 'fs'
import { createHTMLComponentGenerator } from '@teleporthq/teleport-component-generator-html'
import { GeneratedFile } from '@teleporthq/teleport-types'
// import uidlSample from '../../../examples/test-samples/component-sample.json'

const run = async () => {
  const generator = createHTMLComponentGenerator()
  const result = await generator.generateComponent({
    propDefinitions: {
      link6: {
        id: 'TQ_54qKN2rnOU',
        defaultValue: 'Privacy Policy',
        type: 'string',
      },
      link4: {
        id: 'TQ_7Fxo_OVRlw',
        defaultValue: 'FAQs',
        type: 'string',
      },
      content2: {
        id: 'TQ_BbJL7fL3bq',
        defaultValue:
          'Stay up to date with our latest products and offers by subscribing to our newsletter.',
        type: 'string',
      },
      socialLink1: {
        id: 'TQ_FzOCJiuWgQ',
        defaultValue: '#',
        type: 'string',
      },
      termsLink: {
        id: 'TQ_IRi5FayRkB',
        defaultValue: '#terms',
        type: 'string',
      },
      socialLink3: {
        id: 'TQ_JgRkmC3HTt',
        defaultValue: '#',
        type: 'string',
      },
      socialLink5: {
        id: 'TQ_TGBaTaNc9f',
        defaultValue: '#',
        type: 'string',
      },
      image1Alt: {
        id: 'TQ_UYvwg2pR6n',
        defaultValue: 'Company Logo',
        type: 'string',
      },
      socialLink1Title: {
        id: 'TQ_WcO6YWVydj',
        defaultValue: 'Facebook',
        type: 'string',
      },
      socialLink2: {
        id: 'TQ_YPfvX5b_o3',
        defaultValue: '#',
        type: 'string',
      },
      cookiesLink: {
        id: 'TQ_Yz5Udyw9Fo',
        defaultValue: '#cookies',
        type: 'string',
      },
      socialLink4: {
        id: 'TQ_dc5BuJVLjH',
        defaultValue: '#',
        type: 'string',
      },
      link10: {
        id: 'TQ_fiUjCe0tcE',
        defaultValue: 'Blog',
        type: 'string',
      },
      column1Title: {
        id: 'TQ_hPBYcs_hH2',
        defaultValue: 'Contact Us',
        type: 'string',
      },
      link9: {
        id: 'TQ_lr-7pmUzG1',
        defaultValue: 'Customization Options',
        type: 'string',
      },
      link2: {
        id: 'TQ_pXJoBZcGFr',
        defaultValue: 'Products',
        type: 'string',
      },
      content3: {
        id: 'TQ_qetDcphVKx',
        defaultValue: '© 2022 Your Company. All Rights Reserved.',
        type: 'string',
      },
      image1Src: {
        id: 'TQ_qnF8R7_VrE',
        defaultValue: 'https://play.teleporthq.io/static/svg/default-img.svg',
        type: 'string',
      },
      privacyLink: {
        id: 'TQ_sGHiYS5cnu',
        defaultValue: '#privacy',
        type: 'string',
      },
      link5: {
        id: 'TQ_tiugdTc8TS',
        defaultValue: 'Terms and Conditions',
        type: 'string',
      },
      link1: {
        id: 'TQ_uBE_DSoNTJ',
        defaultValue: 'Home',
        type: 'string',
      },
      link7: {
        id: 'TQ_uKX-yVakGo',
        defaultValue: 'Shipping Information',
        type: 'string',
      },
      link3: {
        id: 'TQ_upYI6oBkPP',
        defaultValue: 'About Us',
        type: 'string',
      },
      action1: {
        id: 'TQ_vU1SpDLMOv',
        defaultValue: 'Subscribe to Newsletter',
        type: 'string',
      },
      link8: {
        id: 'TQ_wJu2DwwIVR',
        defaultValue: 'Returns Policy',
        type: 'string',
      },
      column2Title: {
        id: 'TQ_ykZogb_C0i',
        defaultValue: 'Quick Links',
        type: 'string',
      },
    },
    stateDefinitions: {},
    node: {
      type: 'element',
      content: {
        elementType: 'container',
        name: 'Footer1',
        abilities: {},
        style: {
          width: {
            type: 'static',
            content: '100%',
          },
          height: {
            type: 'static',
            content: 'auto',
          },
          display: {
            type: 'static',
            content: 'flex',
          },
          overflow: {
            type: 'static',
            content: 'hidden',
          },
          position: {
            type: 'static',
            content: 'relative',
          },
          alignItems: {
            type: 'static',
            content: 'center',
          },
          flexShrink: {
            type: 'static',
            content: '0',
          },
          flexDirection: {
            type: 'static',
            content: 'column',
          },
          justifyContent: {
            type: 'static',
            content: 'center',
          },
        },
        children: [
          {
            type: 'element',
            content: {
              elementType: 'container',
              semanticType: 'div',
              name: 'max-width',
              abilities: {},
              style: {
                width: {
                  type: 'static',
                  content: '100%',
                },
                display: {
                  type: 'static',
                  content: 'flex',
                },
                alignItems: {
                  type: 'static',
                  content: 'flex-start',
                },
                flexDirection: {
                  type: 'static',
                  content: 'column',
                },
              },
              children: [
                {
                  type: 'element',
                  content: {
                    elementType: 'container',
                    name: 'Content',
                    referencedStyles: {
                      TQ_OBIwVb9WpL: {
                        type: 'style-map',
                        content: {
                          conditions: [
                            {
                              maxWidth: 767,
                              conditionType: 'screen-size',
                            },
                          ],
                          mapType: 'inlined',
                          styles: {
                            flexDirection: {
                              type: 'static',
                              content: 'column',
                            },
                          },
                        },
                      },
                    },
                    abilities: {},
                    style: {
                      gap: {
                        type: 'dynamic',
                        content: {
                          referenceType: 'token',
                          id: '--dl-space-space-fourunits',
                          fallback: '',
                        },
                      },
                      width: {
                        type: 'static',
                        content: '100%',
                      },
                      display: {
                        type: 'static',
                        content: 'flex',
                      },
                      alignSelf: {
                        type: 'static',
                        content: 'stretch',
                      },
                      alignItems: {
                        type: 'static',
                        content: 'flex-start',
                      },
                      flexShrink: {
                        type: 'static',
                        content: '0',
                      },
                      borderRadius: {
                        type: 'dynamic',
                        content: {
                          referenceType: 'token',
                          id: '--dl-radius-radius-radius4',
                          fallback: '',
                        },
                      },
                    },
                    children: [
                      {
                        type: 'element',
                        content: {
                          elementType: 'container',
                          name: 'Newsletter',
                          referencedStyles: {
                            TQ_9Y53n5Bkpg: {
                              type: 'style-map',
                              content: {
                                conditions: [
                                  {
                                    maxWidth: 767,
                                    conditionType: 'screen-size',
                                  },
                                ],
                                mapType: 'inlined',
                                styles: {
                                  width: {
                                    type: 'static',
                                    content: '100%',
                                  },
                                },
                              },
                            },
                            TQ_yVqLXUZbyb: {
                              type: 'style-map',
                              content: {
                                conditions: [
                                  {
                                    maxWidth: 991,
                                    conditionType: 'screen-size',
                                  },
                                ],
                                mapType: 'inlined',
                                styles: {
                                  width: {
                                    type: 'static',
                                    content: '300px',
                                  },
                                },
                              },
                            },
                          },
                          abilities: {},
                          style: {
                            gap: {
                              type: 'static',
                              content: '24px',
                            },
                            width: {
                              type: 'static',
                              content: '500px',
                            },
                            display: {
                              type: 'static',
                              content: 'flex',
                            },
                            alignItems: {
                              type: 'static',
                              content: 'flex-start',
                            },
                            flexShrink: {
                              type: 'static',
                              content: '0',
                            },
                            flexDirection: {
                              type: 'static',
                              content: 'column',
                            },
                          },
                          children: [
                            {
                              type: 'element',
                              content: {
                                elementType: 'image',
                                name: 'image1',
                                referencedStyles: {},
                                abilities: {},
                                attrs: {
                                  alt: {
                                    type: 'dynamic',
                                    content: {
                                      referenceType: 'prop',
                                      id: 'image1Alt',
                                      fallback: '',
                                    },
                                  },
                                  src: {
                                    type: 'dynamic',
                                    content: {
                                      referenceType: 'prop',
                                      id: 'image1Src',
                                      fallback: '',
                                    },
                                  },
                                },
                                style: {
                                  height: {
                                    type: 'static',
                                    content: '2rem',
                                  },
                                },
                                children: [],
                              },
                            },
                            {
                              type: 'element',
                              content: {
                                elementType: 'text',
                                semanticType: 'span',
                                name: 'content1',
                                abilities: {},
                                children: [
                                  {
                                    type: 'static',
                                    content:
                                      'Subscribe to our newsletter for the latest updates on new features and product releases.',
                                  },
                                ],
                              },
                            },
                            {
                              type: 'element',
                              content: {
                                elementType: 'container',
                                name: 'Actions',
                                referencedStyles: {
                                  TQ_4zcy7et5gO: {
                                    type: 'style-map',
                                    content: {
                                      conditions: [
                                        {
                                          maxWidth: 479,
                                          conditionType: 'screen-size',
                                        },
                                      ],
                                      mapType: 'inlined',
                                      styles: {
                                        width: {
                                          type: 'static',
                                          content: '100%',
                                        },
                                      },
                                    },
                                  },
                                },
                                abilities: {},
                                style: {
                                  gap: {
                                    type: 'static',
                                    content: '16px',
                                  },
                                  width: {
                                    type: 'static',
                                    content: '100%',
                                  },
                                  display: {
                                    type: 'static',
                                    content: 'flex',
                                  },
                                  alignSelf: {
                                    type: 'static',
                                    content: 'stretch',
                                  },
                                  alignItems: {
                                    type: 'static',
                                    content: 'flex-start',
                                  },
                                  flexDirection: {
                                    type: 'static',
                                    content: 'column',
                                  },
                                },
                                children: [
                                  {
                                    type: 'element',
                                    content: {
                                      elementType: 'container',
                                      name: 'Form',
                                      referencedStyles: {
                                        TQ_aIK4Twc8kM: {
                                          type: 'style-map',
                                          content: {
                                            conditions: [
                                              {
                                                maxWidth: 991,
                                                conditionType: 'screen-size',
                                              },
                                            ],
                                            mapType: 'inlined',
                                            styles: {
                                              width: {
                                                type: 'static',
                                                content: '100%',
                                              },
                                              flexDirection: {
                                                type: 'static',
                                                content: 'column',
                                              },
                                            },
                                          },
                                        },
                                        'TQ_g9Qn--Ukd_': {
                                          type: 'style-map',
                                          content: {
                                            conditions: [
                                              {
                                                maxWidth: 767,
                                                conditionType: 'screen-size',
                                              },
                                            ],
                                            mapType: 'inlined',
                                            styles: {
                                              width: {
                                                type: 'static',
                                                content: '100%',
                                              },
                                              flexDirection: {
                                                type: 'static',
                                                content: 'row',
                                              },
                                              justifyContent: {
                                                type: 'static',
                                                content: 'flex-start',
                                              },
                                            },
                                          },
                                        },
                                        TQ_gyVPGlA89e: {
                                          type: 'style-map',
                                          content: {
                                            conditions: [
                                              {
                                                maxWidth: 479,
                                                conditionType: 'screen-size',
                                              },
                                            ],
                                            mapType: 'inlined',
                                            styles: {
                                              width: {
                                                type: 'static',
                                                content: '100%',
                                              },
                                              flexDirection: {
                                                type: 'static',
                                                content: 'column',
                                              },
                                            },
                                          },
                                        },
                                      },
                                      abilities: {},
                                      style: {
                                        gap: {
                                          type: 'dynamic',
                                          content: {
                                            referenceType: 'token',
                                            id: '--dl-space-space-unit',
                                            fallback: '',
                                          },
                                        },
                                        width: {
                                          type: 'static',
                                          content: '100%',
                                        },
                                        display: {
                                          type: 'static',
                                          content: 'flex',
                                        },
                                        alignSelf: {
                                          type: 'static',
                                          content: 'stretch',
                                        },
                                        alignItems: {
                                          type: 'static',
                                          content: 'stretch',
                                        },
                                        flexShrink: {
                                          type: 'static',
                                          content: '0',
                                        },
                                      },
                                      children: [
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'container',
                                            semanticType: 'div',
                                            referencedStyles: {
                                              TQ_6X1990e4PG: {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 479,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    width: {
                                                      type: 'static',
                                                      content: '100%',
                                                    },
                                                  },
                                                },
                                              },
                                              TQ_SnalfIpOvF: {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 991,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    width: {
                                                      type: 'static',
                                                      content: '100%',
                                                    },
                                                  },
                                                },
                                              },
                                              TQ_TI2FKX7Mn3: {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 767,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    width: {
                                                      type: 'static',
                                                      content: '100%',
                                                    },
                                                  },
                                                },
                                              },
                                            },
                                            abilities: {},
                                            style: {
                                              width: {
                                                type: 'static',
                                                content: '365px',
                                              },
                                              display: {
                                                type: 'static',
                                                content: 'flex',
                                              },
                                              alignItems: {
                                                type: 'static',
                                                content: 'flex-start',
                                              },
                                            },
                                            children: [
                                              {
                                                type: 'element',
                                                content: {
                                                  elementType: 'textinput',
                                                  name: 'TextInput',
                                                  referencedStyles: {
                                                    TQ_7yP8Y67YQC: {
                                                      type: 'style-map',
                                                      content: {
                                                        conditions: [
                                                          {
                                                            maxWidth: 991,
                                                            conditionType: 'screen-size',
                                                          },
                                                        ],
                                                        mapType: 'inlined',
                                                        styles: {
                                                          width: {
                                                            type: 'static',
                                                            content: '100%',
                                                          },
                                                          padding: {
                                                            type: 'dynamic',
                                                            content: {
                                                              referenceType: 'token',
                                                              id: '--dl-space-space-halfunit',
                                                              fallback: '',
                                                            },
                                                          },
                                                        },
                                                      },
                                                    },
                                                  },
                                                  abilities: {},
                                                  attrs: {
                                                    type: {
                                                      type: 'static',
                                                      content: 'email',
                                                    },
                                                    placeholder: {
                                                      type: 'static',
                                                      content: 'Enter your email',
                                                    },
                                                  },
                                                  style: {
                                                    gap: {
                                                      type: 'static',
                                                      content: '8px',
                                                    },
                                                    width: {
                                                      type: 'static',
                                                      content: '100%',
                                                    },
                                                    height: {
                                                      type: 'static',
                                                      content: '32px',
                                                    },
                                                    display: {
                                                      type: 'static',
                                                      content: 'flex',
                                                    },
                                                    fontSize: {
                                                      type: 'static',
                                                      content: '16px',
                                                    },
                                                    boxSizing: {
                                                      type: 'static',
                                                      content: 'content-box',
                                                    },
                                                    textAlign: {
                                                      type: 'static',
                                                      content: 'left',
                                                    },
                                                    alignItems: {
                                                      type: 'static',
                                                      content: 'center',
                                                    },
                                                    fontFamily: {
                                                      type: 'static',
                                                      content: 'Roboto',
                                                    },
                                                    fontWeight: {
                                                      type: 'static',
                                                      content: 400,
                                                    },
                                                    backgroundColor: {
                                                      type: 'static',
                                                      content: 'transparent',
                                                    },
                                                  },
                                                  children: [],
                                                },
                                              },
                                            ],
                                          },
                                        },
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'button',
                                            name: 'Button',
                                            referencedStyles: {
                                              TQ_OeW1zCvRUg: {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 479,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    width: {
                                                      type: 'static',
                                                      content: '100%',
                                                    },
                                                  },
                                                },
                                              },
                                              TQ_YAL4TC7nkx: {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 767,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    width: {
                                                      type: 'static',
                                                      content: '208px',
                                                    },
                                                  },
                                                },
                                              },
                                              TQ_qHuGy8fA2d: {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 991,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    width: {
                                                      type: 'static',
                                                      content: '100%',
                                                    },
                                                    paddingTop: {
                                                      type: 'dynamic',
                                                      content: {
                                                        referenceType: 'token',
                                                        id: '--dl-space-space-halfunit',
                                                        fallback: '',
                                                      },
                                                    },
                                                    paddingLeft: {
                                                      type: 'dynamic',
                                                      content: {
                                                        referenceType: 'token',
                                                        id: '--dl-space-space-halfunit',
                                                        fallback: '',
                                                      },
                                                    },
                                                    paddingRight: {
                                                      type: 'dynamic',
                                                      content: {
                                                        referenceType: 'token',
                                                        id: '--dl-space-space-halfunit',
                                                        fallback: '',
                                                      },
                                                    },
                                                    paddingBottom: {
                                                      type: 'dynamic',
                                                      content: {
                                                        referenceType: 'token',
                                                        id: '--dl-space-space-halfunit',
                                                        fallback: '',
                                                      },
                                                    },
                                                  },
                                                },
                                              },
                                            },
                                            abilities: {},
                                            children: [
                                              {
                                                type: 'element',
                                                content: {
                                                  elementType: 'text',
                                                  semanticType: 'span',
                                                  name: 'action1',
                                                  abilities: {},
                                                  children: [
                                                    {
                                                      type: 'dynamic',
                                                      content: {
                                                        referenceType: 'prop',
                                                        id: 'action1',
                                                      },
                                                    },
                                                  ],
                                                },
                                              },
                                            ],
                                          },
                                        },
                                      ],
                                    },
                                  },
                                  {
                                    type: 'element',
                                    content: {
                                      elementType: 'text',
                                      semanticType: 'span',
                                      name: 'content2',
                                      abilities: {},
                                      style: {
                                        fill: {
                                          type: 'dynamic',
                                          content: {
                                            referenceType: 'token',
                                            id: '--dl-color-theme-neutral-dark',
                                            fallback: '',
                                          },
                                        },
                                        color: {
                                          type: 'dynamic',
                                          content: {
                                            referenceType: 'token',
                                            id: '--dl-color-theme-neutral-dark',
                                            fallback: '',
                                          },
                                        },
                                        height: {
                                          type: 'static',
                                          content: 'auto',
                                        },
                                        fontSize: {
                                          type: 'static',
                                          content: '12px',
                                        },
                                        alignSelf: {
                                          type: 'static',
                                          content: 'stretch',
                                        },
                                        fontStyle: {
                                          type: 'static',
                                          content: 'Regular',
                                        },
                                        textAlign: {
                                          type: 'static',
                                          content: 'left',
                                        },
                                        fontFamily: {
                                          type: 'static',
                                          content: '"Roboto"',
                                        },
                                        fontWeight: {
                                          type: 'static',
                                          content: '400',
                                        },
                                        lineHeight: {
                                          type: 'static',
                                          content: '150%',
                                        },
                                        fontStretch: {
                                          type: 'static',
                                          content: 'normal',
                                        },
                                        textDecoration: {
                                          type: 'static',
                                          content: 'none',
                                        },
                                      },
                                      children: [
                                        {
                                          type: 'dynamic',
                                          content: {
                                            referenceType: 'prop',
                                            id: 'content2',
                                          },
                                        },
                                      ],
                                    },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                      {
                        type: 'element',
                        content: {
                          elementType: 'container',
                          name: 'Links',
                          referencedStyles: {
                            TQ_HeXgs1jfJ8: {
                              type: 'style-map',
                              content: {
                                conditions: [
                                  {
                                    maxWidth: 767,
                                    conditionType: 'screen-size',
                                  },
                                ],
                                mapType: 'inlined',
                                styles: {
                                  width: {
                                    type: 'static',
                                    content: '100%',
                                  },
                                  alignItems: {
                                    type: 'static',
                                    content: 'flex-start',
                                  },
                                  justifyContent: {
                                    type: 'static',
                                    content: 'center',
                                  },
                                },
                              },
                            },
                            TQ_mb1Hq78ms1: {
                              type: 'style-map',
                              content: {
                                conditions: [
                                  {
                                    maxWidth: 479,
                                    conditionType: 'screen-size',
                                  },
                                ],
                                mapType: 'inlined',
                                styles: {
                                  flexDirection: {
                                    type: 'static',
                                    content: 'column',
                                  },
                                },
                              },
                            },
                          },
                          abilities: {},
                          style: {
                            gap: {
                              type: 'dynamic',
                              content: {
                                referenceType: 'token',
                                id: '--dl-space-space-twounits',
                                fallback: '',
                              },
                            },
                            width: {
                              type: 'static',
                              content: '100%',
                            },
                            display: {
                              type: 'static',
                              content: 'flex',
                            },
                            flexGrow: {
                              type: 'static',
                              content: '1',
                            },
                            alignItems: {
                              type: 'static',
                              content: 'flex-start',
                            },
                            justifyContent: {
                              type: 'static',
                              content: 'flex-end',
                            },
                          },
                          children: [
                            {
                              type: 'element',
                              content: {
                                elementType: 'container',
                                name: 'Column1',
                                referencedStyles: {
                                  TQ_KuJYMv0hQ7: {
                                    type: 'style-map',
                                    content: {
                                      conditions: [
                                        {
                                          maxWidth: 767,
                                          conditionType: 'screen-size',
                                        },
                                      ],
                                      mapType: 'inlined',
                                      styles: {
                                        alignItems: {
                                          type: 'static',
                                          content: 'center',
                                        },
                                      },
                                    },
                                  },
                                  TQ_px20kalX8g: {
                                    type: 'style-map',
                                    content: {
                                      conditions: [
                                        {
                                          maxWidth: 479,
                                          conditionType: 'screen-size',
                                        },
                                      ],
                                      mapType: 'inlined',
                                      styles: {
                                        width: {
                                          type: 'static',
                                          content: '100%',
                                        },
                                        maxWidth: {
                                          type: 'static',
                                          content: '100%',
                                        },
                                        alignItems: {
                                          type: 'static',
                                          content: 'center',
                                        },
                                        justifyContent: {
                                          type: 'static',
                                          content: 'center',
                                        },
                                      },
                                    },
                                  },
                                },
                                abilities: {},
                                style: {
                                  gap: {
                                    type: 'dynamic',
                                    content: {
                                      referenceType: 'token',
                                      id: '--dl-space-space-unit',
                                      fallback: '',
                                    },
                                  },
                                  width: {
                                    type: 'static',
                                    content: 'auto',
                                  },
                                  display: {
                                    type: 'static',
                                    content: 'flex',
                                  },
                                  flexGrow: {
                                    type: 'static',
                                    content: '1',
                                  },
                                  maxWidth: {
                                    type: 'static',
                                    content: '300px',
                                  },
                                  overflow: {
                                    type: 'static',
                                    content: 'hidden',
                                  },
                                  alignItems: {
                                    type: 'static',
                                    content: 'flex-start',
                                  },
                                  flexShrink: {
                                    type: 'static',
                                    content: '0',
                                  },
                                  flexDirection: {
                                    type: 'static',
                                    content: 'column',
                                  },
                                },
                                children: [
                                  {
                                    type: 'element',
                                    content: {
                                      elementType: 'text',
                                      semanticType: 'strong',
                                      name: 'column1Title',
                                      referencedStyles: {
                                        TQ_6ypxJ0iT0h: {
                                          type: 'style-map',
                                          content: {
                                            conditions: [
                                              {
                                                maxWidth: 767,
                                                conditionType: 'screen-size',
                                              },
                                            ],
                                            mapType: 'inlined',
                                            styles: {
                                              textAlign: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                            },
                                          },
                                        },
                                      },
                                      abilities: {},
                                      children: [
                                        {
                                          type: 'dynamic',
                                          content: {
                                            referenceType: 'prop',
                                            id: 'column1Title',
                                          },
                                        },
                                      ],
                                    },
                                  },
                                  {
                                    type: 'element',
                                    content: {
                                      elementType: 'container',
                                      name: 'FooterLinks',
                                      referencedStyles: {
                                        TQ_WQMaMyqZgI: {
                                          type: 'style-map',
                                          content: {
                                            conditions: [
                                              {
                                                maxWidth: 767,
                                                conditionType: 'screen-size',
                                              },
                                            ],
                                            mapType: 'inlined',
                                            styles: {
                                              alignSelf: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                            },
                                          },
                                        },
                                        TQ_hip3tgirsc: {
                                          type: 'style-map',
                                          content: {
                                            conditions: [
                                              {
                                                maxWidth: 479,
                                                conditionType: 'screen-size',
                                              },
                                            ],
                                            mapType: 'inlined',
                                            styles: {
                                              alignItems: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                              justifyContent: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                            },
                                          },
                                        },
                                      },
                                      abilities: {},
                                      style: {
                                        gap: {
                                          type: 'dynamic',
                                          content: {
                                            referenceType: 'token',
                                            id: '--dl-space-space-halfunit',
                                            fallback: '',
                                          },
                                        },
                                        display: {
                                          type: 'static',
                                          content: 'flex',
                                        },
                                        alignSelf: {
                                          type: 'static',
                                          content: 'stretch',
                                        },
                                        alignItems: {
                                          type: 'static',
                                          content: 'flex-start',
                                        },
                                        flexDirection: {
                                          type: 'static',
                                          content: 'column',
                                        },
                                      },
                                      children: [
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'text',
                                            semanticType: 'span',
                                            name: 'link1',
                                            abilities: {},
                                            children: [
                                              {
                                                type: 'dynamic',
                                                content: {
                                                  referenceType: 'prop',
                                                  id: 'link1',
                                                },
                                              },
                                            ],
                                          },
                                        },
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'text',
                                            semanticType: 'span',
                                            name: 'link2',
                                            abilities: {},
                                            children: [
                                              {
                                                type: 'dynamic',
                                                content: {
                                                  referenceType: 'prop',
                                                  id: 'link2',
                                                },
                                              },
                                            ],
                                          },
                                        },
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'text',
                                            semanticType: 'span',
                                            name: 'link3',
                                            abilities: {},
                                            children: [
                                              {
                                                type: 'dynamic',
                                                content: {
                                                  referenceType: 'prop',
                                                  id: 'link3',
                                                },
                                              },
                                            ],
                                          },
                                        },
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'text',
                                            semanticType: 'span',
                                            name: 'link4',
                                            abilities: {},
                                            children: [
                                              {
                                                type: 'dynamic',
                                                content: {
                                                  referenceType: 'prop',
                                                  id: 'link4',
                                                },
                                              },
                                            ],
                                          },
                                        },
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'text',
                                            semanticType: 'span',
                                            name: 'link5',
                                            abilities: {},
                                            children: [
                                              {
                                                type: 'dynamic',
                                                content: {
                                                  referenceType: 'prop',
                                                  id: 'link5',
                                                },
                                              },
                                            ],
                                          },
                                        },
                                      ],
                                    },
                                  },
                                ],
                              },
                            },
                            {
                              type: 'element',
                              content: {
                                elementType: 'container',
                                name: 'Column2',
                                referencedStyles: {
                                  TQ_763q19FtB4: {
                                    type: 'style-map',
                                    content: {
                                      conditions: [
                                        {
                                          maxWidth: 767,
                                          conditionType: 'screen-size',
                                        },
                                      ],
                                      mapType: 'inlined',
                                      styles: {
                                        alignItems: {
                                          type: 'static',
                                          content: 'center',
                                        },
                                      },
                                    },
                                  },
                                  'TQ_ns3YD-dz7S': {
                                    type: 'style-map',
                                    content: {
                                      conditions: [
                                        {
                                          maxWidth: 479,
                                          conditionType: 'screen-size',
                                        },
                                      ],
                                      mapType: 'inlined',
                                      styles: {
                                        width: {
                                          type: 'static',
                                          content: '100%',
                                        },
                                        maxWidth: {
                                          type: 'static',
                                          content: '100%',
                                        },
                                        alignItems: {
                                          type: 'static',
                                          content: 'center',
                                        },
                                        justifyContent: {
                                          type: 'static',
                                          content: 'center',
                                        },
                                      },
                                    },
                                  },
                                },
                                abilities: {},
                                style: {
                                  gap: {
                                    type: 'dynamic',
                                    content: {
                                      referenceType: 'token',
                                      id: '--dl-space-space-unit',
                                      fallback: '',
                                    },
                                  },
                                  width: {
                                    type: 'static',
                                    content: 'auto',
                                  },
                                  display: {
                                    type: 'static',
                                    content: 'flex',
                                  },
                                  flexGrow: {
                                    type: 'static',
                                    content: '1',
                                  },
                                  maxWidth: {
                                    type: 'static',
                                    content: '300px',
                                  },
                                  overflow: {
                                    type: 'static',
                                    content: 'hidden',
                                  },
                                  alignItems: {
                                    type: 'static',
                                    content: 'flex-start',
                                  },
                                  flexShrink: {
                                    type: 'static',
                                    content: '0',
                                  },
                                  flexDirection: {
                                    type: 'static',
                                    content: 'column',
                                  },
                                },
                                children: [
                                  {
                                    type: 'element',
                                    content: {
                                      elementType: 'text',
                                      semanticType: 'strong',
                                      name: 'column2Title',
                                      referencedStyles: {
                                        TQ_dUNwIc7mLj: {
                                          type: 'style-map',
                                          content: {
                                            conditions: [
                                              {
                                                maxWidth: 767,
                                                conditionType: 'screen-size',
                                              },
                                            ],
                                            mapType: 'inlined',
                                            styles: {
                                              textAlign: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                            },
                                          },
                                        },
                                      },
                                      abilities: {},
                                      children: [
                                        {
                                          type: 'dynamic',
                                          content: {
                                            referenceType: 'prop',
                                            id: 'column2Title',
                                          },
                                        },
                                      ],
                                    },
                                  },
                                  {
                                    type: 'element',
                                    content: {
                                      elementType: 'container',
                                      name: 'FooterLinks',
                                      referencedStyles: {
                                        TQ_1w4EAZOl0v: {
                                          type: 'style-map',
                                          content: {
                                            conditions: [
                                              {
                                                maxWidth: 479,
                                                conditionType: 'screen-size',
                                              },
                                            ],
                                            mapType: 'inlined',
                                            styles: {
                                              alignItems: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                              justifyContent: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                            },
                                          },
                                        },
                                        TQ_gtcDPuwr6H: {
                                          type: 'style-map',
                                          content: {
                                            conditions: [
                                              {
                                                maxWidth: 767,
                                                conditionType: 'screen-size',
                                              },
                                            ],
                                            mapType: 'inlined',
                                            styles: {
                                              alignSelf: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                            },
                                          },
                                        },
                                      },
                                      abilities: {},
                                      style: {
                                        gap: {
                                          type: 'dynamic',
                                          content: {
                                            referenceType: 'token',
                                            id: '--dl-space-space-halfunit',
                                            fallback: '',
                                          },
                                        },
                                        display: {
                                          type: 'static',
                                          content: 'flex',
                                        },
                                        alignSelf: {
                                          type: 'static',
                                          content: 'stretch',
                                        },
                                        alignItems: {
                                          type: 'static',
                                          content: 'flex-start',
                                        },
                                        flexDirection: {
                                          type: 'static',
                                          content: 'column',
                                        },
                                      },
                                      children: [
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'text',
                                            semanticType: 'span',
                                            name: 'link6',
                                            abilities: {},
                                            children: [
                                              {
                                                type: 'dynamic',
                                                content: {
                                                  referenceType: 'prop',
                                                  id: 'link6',
                                                },
                                              },
                                            ],
                                          },
                                        },
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'text',
                                            semanticType: 'span',
                                            name: 'link7',
                                            abilities: {},
                                            children: [
                                              {
                                                type: 'dynamic',
                                                content: {
                                                  referenceType: 'prop',
                                                  id: 'link7',
                                                },
                                              },
                                            ],
                                          },
                                        },
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'text',
                                            semanticType: 'span',
                                            name: 'link8',
                                            abilities: {},
                                            children: [
                                              {
                                                type: 'dynamic',
                                                content: {
                                                  referenceType: 'prop',
                                                  id: 'link8',
                                                },
                                              },
                                            ],
                                          },
                                        },
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'text',
                                            semanticType: 'span',
                                            name: 'link9',
                                            abilities: {},
                                            children: [
                                              {
                                                type: 'dynamic',
                                                content: {
                                                  referenceType: 'prop',
                                                  id: 'link9',
                                                },
                                              },
                                            ],
                                          },
                                        },
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'text',
                                            semanticType: 'span',
                                            name: 'link10',
                                            abilities: {},
                                            children: [
                                              {
                                                type: 'dynamic',
                                                content: {
                                                  referenceType: 'prop',
                                                  id: 'link10',
                                                },
                                              },
                                            ],
                                          },
                                        },
                                      ],
                                    },
                                  },
                                ],
                              },
                            },
                            {
                              type: 'element',
                              content: {
                                elementType: 'container',
                                name: 'Column3',
                                referencedStyles: {
                                  TQ_WhpIkb3CCV: {
                                    type: 'style-map',
                                    content: {
                                      conditions: [
                                        {
                                          maxWidth: 767,
                                          conditionType: 'screen-size',
                                        },
                                      ],
                                      mapType: 'inlined',
                                      styles: {
                                        alignItems: {
                                          type: 'static',
                                          content: 'center',
                                        },
                                      },
                                    },
                                  },
                                  'TQ_hw-OwWIqW3': {
                                    type: 'style-map',
                                    content: {
                                      conditions: [
                                        {
                                          maxWidth: 479,
                                          conditionType: 'screen-size',
                                        },
                                      ],
                                      mapType: 'inlined',
                                      styles: {
                                        width: {
                                          type: 'static',
                                          content: '100%',
                                        },
                                        maxWidth: {
                                          type: 'static',
                                          content: '100%',
                                        },
                                        alignItems: {
                                          type: 'static',
                                          content: 'center',
                                        },
                                        justifyContent: {
                                          type: 'static',
                                          content: 'center',
                                        },
                                      },
                                    },
                                  },
                                },
                                abilities: {},
                                style: {
                                  gap: {
                                    type: 'dynamic',
                                    content: {
                                      referenceType: 'token',
                                      id: '--dl-space-space-unit',
                                      fallback: '',
                                    },
                                  },
                                  width: {
                                    type: 'static',
                                    content: 'auto',
                                  },
                                  display: {
                                    type: 'static',
                                    content: 'flex',
                                  },
                                  flexGrow: {
                                    type: 'static',
                                    content: '1',
                                  },
                                  maxWidth: {
                                    type: 'static',
                                    content: '300px',
                                  },
                                  overflow: {
                                    type: 'static',
                                    content: 'hidden',
                                  },
                                  alignItems: {
                                    type: 'static',
                                    content: 'flex-start',
                                  },
                                  flexShrink: {
                                    type: 'static',
                                    content: '0',
                                  },
                                  flexDirection: {
                                    type: 'static',
                                    content: 'column',
                                  },
                                },
                                children: [
                                  {
                                    type: 'element',
                                    content: {
                                      elementType: 'text',
                                      semanticType: 'strong',
                                      name: 'socialLink1Title',
                                      referencedStyles: {
                                        'TQ_-uYu6laMcI': {
                                          type: 'style-map',
                                          content: {
                                            conditions: [
                                              {
                                                maxWidth: 767,
                                                conditionType: 'screen-size',
                                              },
                                            ],
                                            mapType: 'inlined',
                                            styles: {
                                              textAlign: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                            },
                                          },
                                        },
                                      },
                                      abilities: {},
                                      children: [
                                        {
                                          type: 'dynamic',
                                          content: {
                                            referenceType: 'prop',
                                            id: 'socialLink1Title',
                                          },
                                        },
                                      ],
                                    },
                                  },
                                  {
                                    type: 'element',
                                    content: {
                                      elementType: 'container',
                                      name: 'SocialLinks',
                                      referencedStyles: {
                                        TQ_NFAhZFldTl: {
                                          type: 'style-map',
                                          content: {
                                            conditions: [
                                              {
                                                maxWidth: 767,
                                                conditionType: 'screen-size',
                                              },
                                            ],
                                            mapType: 'inlined',
                                            styles: {
                                              alignSelf: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                            },
                                          },
                                        },
                                        TQ_jIzgC5rdU1: {
                                          type: 'style-map',
                                          content: {
                                            conditions: [
                                              {
                                                maxWidth: 479,
                                                conditionType: 'screen-size',
                                              },
                                            ],
                                            mapType: 'inlined',
                                            styles: {
                                              alignItems: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                              justifyContent: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                            },
                                          },
                                        },
                                      },
                                      abilities: {},
                                      style: {
                                        gap: {
                                          type: 'dynamic',
                                          content: {
                                            referenceType: 'token',
                                            id: '--dl-space-space-halfunit',
                                            fallback: '',
                                          },
                                        },
                                        display: {
                                          type: 'static',
                                          content: 'flex',
                                        },
                                        alignSelf: {
                                          type: 'static',
                                          content: 'stretch',
                                        },
                                        alignItems: {
                                          type: 'static',
                                          content: 'flex-start',
                                        },
                                        flexDirection: {
                                          type: 'static',
                                          content: 'column',
                                        },
                                      },
                                      children: [
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'container',
                                            name: 'Link',
                                            referencedStyles: {
                                              TQ_MVfi2OngXT: {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 767,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    alignSelf: {
                                                      type: 'static',
                                                      content: 'center',
                                                    },
                                                  },
                                                },
                                              },
                                              TQ_bbhAB18jgT: {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 479,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    justifyContent: {
                                                      type: 'static',
                                                      content: 'center',
                                                    },
                                                  },
                                                },
                                              },
                                            },
                                            abilities: {},
                                            style: {
                                              gap: {
                                                type: 'static',
                                                content: '12px',
                                              },
                                              display: {
                                                type: 'static',
                                                content: 'flex',
                                              },
                                              padding: {
                                                type: 'static',
                                                content: '8px 0',
                                              },
                                              alignSelf: {
                                                type: 'static',
                                                content: 'stretch',
                                              },
                                              alignItems: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                              flexShrink: {
                                                type: 'static',
                                                content: '0',
                                              },
                                            },
                                            children: [
                                              {
                                                type: 'element',
                                                content: {
                                                  elementType: 'icon',
                                                  abilities: {},
                                                  attrs: {
                                                    viewBox: {
                                                      type: 'static',
                                                      content: '0 0 877.7142857142857 1024',
                                                    },
                                                  },
                                                  children: [
                                                    {
                                                      type: 'element',
                                                      content: {
                                                        elementType: 'icon',
                                                        semanticType: 'path',
                                                        referencedStyles: {},
                                                        abilities: {},
                                                        attrs: {
                                                          d: {
                                                            type: 'static',
                                                            content:
                                                              'M713.143 73.143c90.857 0 164.571 73.714 164.571 164.571v548.571c0 90.857-73.714 164.571-164.571 164.571h-107.429v-340h113.714l17.143-132.571h-130.857v-84.571c0-38.286 10.286-64 65.714-64l69.714-0.571v-118.286c-12-1.714-53.714-5.143-101.714-5.143-101.143 0-170.857 61.714-170.857 174.857v97.714h-114.286v132.571h114.286v340h-304c-90.857 0-164.571-73.714-164.571-164.571v-548.571c0-90.857 73.714-164.571 164.571-164.571h548.571z',
                                                          },
                                                        },
                                                        children: [],
                                                      },
                                                    },
                                                  ],
                                                },
                                              },
                                              {
                                                type: 'element',
                                                content: {
                                                  elementType: 'text',
                                                  semanticType: 'span',
                                                  name: 'socialLink1',
                                                  abilities: {},
                                                  children: [
                                                    {
                                                      type: 'dynamic',
                                                      content: {
                                                        referenceType: 'prop',
                                                        id: 'socialLink1',
                                                      },
                                                    },
                                                  ],
                                                },
                                              },
                                            ],
                                          },
                                        },
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'container',
                                            name: 'Link',
                                            referencedStyles: {
                                              TQ_MrK68yk32A: {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 479,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    justifyContent: {
                                                      type: 'static',
                                                      content: 'center',
                                                    },
                                                  },
                                                },
                                              },
                                              TQ_trTinv0mXK: {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 767,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    alignSelf: {
                                                      type: 'static',
                                                      content: 'center',
                                                    },
                                                  },
                                                },
                                              },
                                            },
                                            abilities: {},
                                            style: {
                                              gap: {
                                                type: 'static',
                                                content: '12px',
                                              },
                                              display: {
                                                type: 'static',
                                                content: 'flex',
                                              },
                                              padding: {
                                                type: 'static',
                                                content: '8px 0',
                                              },
                                              alignSelf: {
                                                type: 'static',
                                                content: 'stretch',
                                              },
                                              alignItems: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                              flexShrink: {
                                                type: 'static',
                                                content: '0',
                                              },
                                            },
                                            children: [
                                              {
                                                type: 'element',
                                                content: {
                                                  elementType: 'icon',
                                                  abilities: {},
                                                  attrs: {
                                                    viewBox: {
                                                      type: 'static',
                                                      content: '0 0 877.7142857142857 1024',
                                                    },
                                                  },
                                                  children: [
                                                    {
                                                      type: 'element',
                                                      content: {
                                                        elementType: 'icon',
                                                        semanticType: 'path',
                                                        referencedStyles: {},
                                                        abilities: {},
                                                        attrs: {
                                                          d: {
                                                            type: 'static',
                                                            content:
                                                              'M585.143 512c0-80.571-65.714-146.286-146.286-146.286s-146.286 65.714-146.286 146.286 65.714 146.286 146.286 146.286 146.286-65.714 146.286-146.286zM664 512c0 124.571-100.571 225.143-225.143 225.143s-225.143-100.571-225.143-225.143 100.571-225.143 225.143-225.143 225.143 100.571 225.143 225.143zM725.714 277.714c0 29.143-23.429 52.571-52.571 52.571s-52.571-23.429-52.571-52.571 23.429-52.571 52.571-52.571 52.571 23.429 52.571 52.571zM438.857 152c-64 0-201.143-5.143-258.857 17.714-20 8-34.857 17.714-50.286 33.143s-25.143 30.286-33.143 50.286c-22.857 57.714-17.714 194.857-17.714 258.857s-5.143 201.143 17.714 258.857c8 20 17.714 34.857 33.143 50.286s30.286 25.143 50.286 33.143c57.714 22.857 194.857 17.714 258.857 17.714s201.143 5.143 258.857-17.714c20-8 34.857-17.714 50.286-33.143s25.143-30.286 33.143-50.286c22.857-57.714 17.714-194.857 17.714-258.857s5.143-201.143-17.714-258.857c-8-20-17.714-34.857-33.143-50.286s-30.286-25.143-50.286-33.143c-57.714-22.857-194.857-17.714-258.857-17.714zM877.714 512c0 60.571 0.571 120.571-2.857 181.143-3.429 70.286-19.429 132.571-70.857 184s-113.714 67.429-184 70.857c-60.571 3.429-120.571 2.857-181.143 2.857s-120.571 0.571-181.143-2.857c-70.286-3.429-132.571-19.429-184-70.857s-67.429-113.714-70.857-184c-3.429-60.571-2.857-120.571-2.857-181.143s-0.571-120.571 2.857-181.143c3.429-70.286 19.429-132.571 70.857-184s113.714-67.429 184-70.857c60.571-3.429 120.571-2.857 181.143-2.857s120.571-0.571 181.143 2.857c70.286 3.429 132.571 19.429 184 70.857s67.429 113.714 70.857 184c3.429 60.571 2.857 120.571 2.857 181.143z',
                                                          },
                                                        },
                                                        children: [],
                                                      },
                                                    },
                                                  ],
                                                },
                                              },
                                              {
                                                type: 'element',
                                                content: {
                                                  elementType: 'text',
                                                  semanticType: 'span',
                                                  name: 'socialLink2',
                                                  abilities: {},
                                                  children: [
                                                    {
                                                      type: 'dynamic',
                                                      content: {
                                                        referenceType: 'prop',
                                                        id: 'socialLink2',
                                                      },
                                                    },
                                                  ],
                                                },
                                              },
                                            ],
                                          },
                                        },
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'container',
                                            name: 'Link',
                                            referencedStyles: {
                                              'TQ_KWcmfS-nYu': {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 479,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    justifyContent: {
                                                      type: 'static',
                                                      content: 'center',
                                                    },
                                                  },
                                                },
                                              },
                                              TQ_l2nPiFfXcl: {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 767,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    alignSelf: {
                                                      type: 'static',
                                                      content: 'center',
                                                    },
                                                  },
                                                },
                                              },
                                            },
                                            abilities: {},
                                            style: {
                                              gap: {
                                                type: 'static',
                                                content: '12px',
                                              },
                                              display: {
                                                type: 'static',
                                                content: 'flex',
                                              },
                                              padding: {
                                                type: 'static',
                                                content: '8px 0',
                                              },
                                              alignSelf: {
                                                type: 'static',
                                                content: 'stretch',
                                              },
                                              alignItems: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                              flexShrink: {
                                                type: 'static',
                                                content: '0',
                                              },
                                            },
                                            children: [
                                              {
                                                type: 'element',
                                                content: {
                                                  elementType: 'icon',
                                                  abilities: {},
                                                  attrs: {
                                                    viewBox: {
                                                      type: 'static',
                                                      content: '0 0 950.8571428571428 1024',
                                                    },
                                                  },
                                                  children: [
                                                    {
                                                      type: 'element',
                                                      content: {
                                                        elementType: 'icon',
                                                        semanticType: 'path',
                                                        referencedStyles: {},
                                                        abilities: {},
                                                        attrs: {
                                                          d: {
                                                            type: 'static',
                                                            content:
                                                              'M925.714 233.143c-25.143 36.571-56.571 69.143-92.571 95.429 0.571 8 0.571 16 0.571 24 0 244-185.714 525.143-525.143 525.143-104.571 0-201.714-30.286-283.429-82.857 14.857 1.714 29.143 2.286 44.571 2.286 86.286 0 165.714-29.143 229.143-78.857-81.143-1.714-149.143-54.857-172.571-128 11.429 1.714 22.857 2.857 34.857 2.857 16.571 0 33.143-2.286 48.571-6.286-84.571-17.143-148-91.429-148-181.143v-2.286c24.571 13.714 53.143 22.286 83.429 23.429-49.714-33.143-82.286-89.714-82.286-153.714 0-34.286 9.143-65.714 25.143-93.143 90.857 112 227.429 185.143 380.571 193.143-2.857-13.714-4.571-28-4.571-42.286 0-101.714 82.286-184.571 184.571-184.571 53.143 0 101.143 22.286 134.857 58.286 41.714-8 81.714-23.429 117.143-44.571-13.714 42.857-42.857 78.857-81.143 101.714 37.143-4 73.143-14.286 106.286-28.571z',
                                                          },
                                                        },
                                                        children: [],
                                                      },
                                                    },
                                                  ],
                                                },
                                              },
                                              {
                                                type: 'element',
                                                content: {
                                                  elementType: 'text',
                                                  semanticType: 'span',
                                                  name: 'socialLink3',
                                                  abilities: {},
                                                  children: [
                                                    {
                                                      type: 'dynamic',
                                                      content: {
                                                        referenceType: 'prop',
                                                        id: 'socialLink3',
                                                      },
                                                    },
                                                  ],
                                                },
                                              },
                                            ],
                                          },
                                        },
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'container',
                                            name: 'Link',
                                            referencedStyles: {
                                              TQ_5OVnFagD7K: {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 479,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    justifyContent: {
                                                      type: 'static',
                                                      content: 'center',
                                                    },
                                                  },
                                                },
                                              },
                                              TQ_W_6fCE3bcC: {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 767,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    alignSelf: {
                                                      type: 'static',
                                                      content: 'center',
                                                    },
                                                  },
                                                },
                                              },
                                            },
                                            abilities: {},
                                            style: {
                                              gap: {
                                                type: 'static',
                                                content: '12px',
                                              },
                                              display: {
                                                type: 'static',
                                                content: 'flex',
                                              },
                                              padding: {
                                                type: 'static',
                                                content: '8px 0',
                                              },
                                              alignSelf: {
                                                type: 'static',
                                                content: 'stretch',
                                              },
                                              alignItems: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                              flexShrink: {
                                                type: 'static',
                                                content: '0',
                                              },
                                            },
                                            children: [
                                              {
                                                type: 'element',
                                                content: {
                                                  elementType: 'icon',
                                                  abilities: {},
                                                  attrs: {
                                                    viewBox: {
                                                      type: 'static',
                                                      content: '0 0 877.7142857142857 1024',
                                                    },
                                                  },
                                                  children: [
                                                    {
                                                      type: 'element',
                                                      content: {
                                                        elementType: 'icon',
                                                        semanticType: 'path',
                                                        referencedStyles: {},
                                                        abilities: {},
                                                        attrs: {
                                                          d: {
                                                            type: 'static',
                                                            content:
                                                              'M135.429 808h132v-396.571h-132v396.571zM276 289.143c-0.571-38.857-28.571-68.571-73.714-68.571s-74.857 29.714-74.857 68.571c0 37.714 28.571 68.571 73.143 68.571h0.571c46.286 0 74.857-30.857 74.857-68.571zM610.286 808h132v-227.429c0-121.714-65.143-178.286-152-178.286-70.857 0-102.286 39.429-119.429 66.857h1.143v-57.714h-132s1.714 37.143 0 396.571v0h132v-221.714c0-11.429 0.571-23.429 4-32 9.714-23.429 31.429-48 68-48 47.429 0 66.286 36 66.286 89.714v212zM877.714 237.714v548.571c0 90.857-73.714 164.571-164.571 164.571h-548.571c-90.857 0-164.571-73.714-164.571-164.571v-548.571c0-90.857 73.714-164.571 164.571-164.571h548.571c90.857 0 164.571 73.714 164.571 164.571z',
                                                          },
                                                        },
                                                        children: [],
                                                      },
                                                    },
                                                  ],
                                                },
                                              },
                                              {
                                                type: 'element',
                                                content: {
                                                  elementType: 'text',
                                                  semanticType: 'span',
                                                  name: 'socialLink4',
                                                  abilities: {},
                                                  children: [
                                                    {
                                                      type: 'dynamic',
                                                      content: {
                                                        referenceType: 'prop',
                                                        id: 'socialLink4',
                                                      },
                                                    },
                                                  ],
                                                },
                                              },
                                            ],
                                          },
                                        },
                                        {
                                          type: 'element',
                                          content: {
                                            elementType: 'container',
                                            name: 'Link',
                                            referencedStyles: {
                                              TQ_KnezFfxUOi: {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 479,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    paddingTop: {
                                                      type: 'dynamic',
                                                      content: {
                                                        referenceType: 'token',
                                                        id: '--dl-space-space-halfunit',
                                                        fallback: '',
                                                      },
                                                    },
                                                    paddingBottom: {
                                                      type: 'dynamic',
                                                      content: {
                                                        referenceType: 'token',
                                                        id: '--dl-space-space-halfunit',
                                                        fallback: '',
                                                      },
                                                    },
                                                    justifyContent: {
                                                      type: 'static',
                                                      content: 'center',
                                                    },
                                                  },
                                                },
                                              },
                                              TQ_lJO95lNi4I: {
                                                type: 'style-map',
                                                content: {
                                                  conditions: [
                                                    {
                                                      maxWidth: 767,
                                                      conditionType: 'screen-size',
                                                    },
                                                  ],
                                                  mapType: 'inlined',
                                                  styles: {
                                                    alignSelf: {
                                                      type: 'static',
                                                      content: 'center',
                                                    },
                                                  },
                                                },
                                              },
                                            },
                                            abilities: {},
                                            style: {
                                              gap: {
                                                type: 'static',
                                                content: '12px',
                                              },
                                              display: {
                                                type: 'static',
                                                content: 'flex',
                                              },
                                              padding: {
                                                type: 'static',
                                                content: '8px 0',
                                              },
                                              alignSelf: {
                                                type: 'static',
                                                content: 'stretch',
                                              },
                                              alignItems: {
                                                type: 'static',
                                                content: 'center',
                                              },
                                              flexShrink: {
                                                type: 'static',
                                                content: '0',
                                              },
                                            },
                                            children: [
                                              {
                                                type: 'element',
                                                content: {
                                                  elementType: 'icon',
                                                  abilities: {},
                                                  attrs: {
                                                    viewBox: {
                                                      type: 'static',
                                                      content: '0 0 1024 1024',
                                                    },
                                                  },
                                                  children: [
                                                    {
                                                      type: 'element',
                                                      content: {
                                                        elementType: 'icon',
                                                        semanticType: 'path',
                                                        referencedStyles: {},
                                                        abilities: {},
                                                        attrs: {
                                                          d: {
                                                            type: 'static',
                                                            content:
                                                              'M406.286 644.571l276.571-142.857-276.571-144.571v287.429zM512 152c215.429 0 358.286 10.286 358.286 10.286 20 2.286 64 2.286 102.857 43.429 0 0 31.429 30.857 40.571 101.714 10.857 82.857 10.286 165.714 10.286 165.714v77.714s0.571 82.857-10.286 165.714c-9.143 70.286-40.571 101.714-40.571 101.714-38.857 40.571-82.857 40.571-102.857 42.857 0 0-142.857 10.857-358.286 10.857v0c-266.286-2.286-348-10.286-348-10.286-22.857-4-74.286-2.857-113.143-43.429 0 0-31.429-31.429-40.571-101.714-10.857-82.857-10.286-165.714-10.286-165.714v-77.714s-0.571-82.857 10.286-165.714c9.143-70.857 40.571-101.714 40.571-101.714 38.857-41.143 82.857-41.143 102.857-43.429 0 0 142.857-10.286 358.286-10.286v0z',
                                                          },
                                                        },
                                                        children: [],
                                                      },
                                                    },
                                                  ],
                                                },
                                              },
                                              {
                                                type: 'element',
                                                content: {
                                                  elementType: 'text',
                                                  semanticType: 'span',
                                                  name: 'socialLink5',
                                                  abilities: {},
                                                  children: [
                                                    {
                                                      type: 'dynamic',
                                                      content: {
                                                        referenceType: 'prop',
                                                        id: 'socialLink5',
                                                      },
                                                    },
                                                  ],
                                                },
                                              },
                                            ],
                                          },
                                        },
                                      ],
                                    },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  type: 'element',
                  content: {
                    elementType: 'container',
                    name: 'Credits',
                    referencedStyles: {
                      TQ_tRjnt8sIpy: {
                        type: 'style-map',
                        content: {
                          conditions: [
                            {
                              maxWidth: 479,
                              conditionType: 'screen-size',
                            },
                          ],
                          mapType: 'inlined',
                          styles: {
                            gap: {
                              type: 'static',
                              content: '0',
                            },
                          },
                        },
                      },
                    },
                    abilities: {},
                    style: {
                      gap: {
                        type: 'dynamic',
                        content: {
                          referenceType: 'token',
                          id: '--dl-space-space-twounits',
                          fallback: '',
                        },
                      },
                      width: {
                        type: 'static',
                        content: '100%',
                      },
                      display: {
                        type: 'static',
                        content: 'flex',
                      },
                      alignSelf: {
                        type: 'static',
                        content: 'stretch',
                      },
                      marginTop: {
                        type: 'dynamic',
                        content: {
                          referenceType: 'token',
                          id: '--dl-space-space-unit',
                          fallback: '',
                        },
                      },
                      alignItems: {
                        type: 'static',
                        content: 'flex-start',
                      },
                      flexDirection: {
                        type: 'static',
                        content: 'column',
                      },
                    },
                    children: [
                      {
                        type: 'element',
                        content: {
                          elementType: 'container',
                          semanticType: 'div',
                          name: 'Divider',
                          abilities: {},
                          children: [],
                        },
                      },
                      {
                        type: 'element',
                        content: {
                          elementType: 'container',
                          name: 'Row',
                          referencedStyles: {
                            TQ_AEH0h4TTrx: {
                              type: 'style-map',
                              content: {
                                conditions: [
                                  {
                                    maxWidth: 479,
                                    conditionType: 'screen-size',
                                  },
                                ],
                                mapType: 'inlined',
                                styles: {
                                  alignItems: {
                                    type: 'static',
                                    content: 'center',
                                  },
                                  justifyContent: {
                                    type: 'static',
                                    content: 'center',
                                  },
                                },
                              },
                            },
                            TQ_guFz5Yz3FQ: {
                              type: 'style-map',
                              content: {
                                conditions: [
                                  {
                                    maxWidth: 767,
                                    conditionType: 'screen-size',
                                  },
                                ],
                                mapType: 'inlined',
                                styles: {
                                  flexDirection: {
                                    type: 'static',
                                    content: 'column',
                                  },
                                },
                              },
                            },
                          },
                          abilities: {},
                          style: {
                            gap: {
                              type: 'static',
                              content: '64px',
                            },
                            display: {
                              type: 'static',
                              content: 'flex',
                            },
                            alignSelf: {
                              type: 'static',
                              content: 'stretch',
                            },
                            alignItems: {
                              type: 'static',
                              content: 'flex-start',
                            },
                            flexShrink: {
                              type: 'static',
                              content: '0',
                            },
                            justifyContent: {
                              type: 'static',
                              content: 'space-between',
                            },
                          },
                          children: [
                            {
                              type: 'element',
                              content: {
                                elementType: 'text',
                                semanticType: 'span',
                                name: 'content3',
                                abilities: {},
                                children: [
                                  {
                                    type: 'dynamic',
                                    content: {
                                      referenceType: 'prop',
                                      id: 'content3',
                                    },
                                  },
                                ],
                              },
                            },
                            {
                              type: 'element',
                              content: {
                                elementType: 'container',
                                name: 'FooterLinks',
                                referencedStyles: {
                                  TQ_LE81NTE6KE: {
                                    type: 'style-map',
                                    content: {
                                      conditions: [
                                        {
                                          maxWidth: 479,
                                          conditionType: 'screen-size',
                                        },
                                      ],
                                      mapType: 'inlined',
                                      styles: {
                                        alignItems: {
                                          type: 'static',
                                          content: 'center',
                                        },
                                        flexDirection: {
                                          type: 'static',
                                          content: 'column',
                                        },
                                        justifyContent: {
                                          type: 'static',
                                          content: 'center',
                                        },
                                      },
                                    },
                                  },
                                },
                                abilities: {},
                                style: {
                                  gap: {
                                    type: 'static',
                                    content: '24px',
                                  },
                                  display: {
                                    type: 'static',
                                    content: 'flex',
                                  },
                                  alignItems: {
                                    type: 'static',
                                    content: 'flex-start',
                                  },
                                },
                                children: [
                                  {
                                    type: 'element',
                                    content: {
                                      elementType: 'text',
                                      semanticType: 'span',
                                      name: 'link11',
                                      abilities: {},
                                      children: [
                                        {
                                          type: 'dynamic',
                                          content: {
                                            referenceType: 'prop',
                                            id: 'privacyLink',
                                          },
                                        },
                                      ],
                                    },
                                  },
                                  {
                                    type: 'element',
                                    content: {
                                      elementType: 'text',
                                      semanticType: 'span',
                                      name: 'link12',
                                      abilities: {},
                                      children: [
                                        {
                                          type: 'dynamic',
                                          content: {
                                            referenceType: 'prop',
                                            id: 'termsLink',
                                          },
                                        },
                                      ],
                                    },
                                  },
                                  {
                                    type: 'element',
                                    content: {
                                      elementType: 'text',
                                      semanticType: 'span',
                                      name: 'link13',
                                      abilities: {},
                                      children: [
                                        {
                                          type: 'dynamic',
                                          content: {
                                            referenceType: 'prop',
                                            id: 'cookiesLink',
                                          },
                                        },
                                      ],
                                    },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    name: 'Footer1',
    styleSetDefinitions: {},
  })
  addfilesToDisk(result.files)
}

const addfilesToDisk = (files: GeneratedFile[]) => {
  files.forEach((file) => {
    const filePath = join(__dirname, '../dist', `${file.name}.${file.fileType}`)

    writeFile(filePath, file.content, 'utf-8', (err) => {
      if (err) {
        throw err
      }
    })
  })
}

run()
