// @ts-ignore
import bigUIDL from './big-sample.json'

export const createUIDL = (
  params: { firstLvl?: number; secondLvl?: number; thirdLvl?: number } = {}
) => {
  const { firstLvl = 100, secondLvl = 10, thirdLvl = 2 } = params
  const fakeUIDL = JSON.parse(JSON.stringify(bigUIDL)) as ComponentUIDL
  for (let index = 0; index < firstLvl; index++) {
    const firstlvlchildren = []
    for (let index2 = 0; index2 < secondLvl; index2++) {
      const secondlvlchildren = []
      for (let index3 = 0; index3 < thirdLvl; index3++) {
        secondlvlchildren.push(
          {
            type: 'element',
            content: {
              elementType: 'image',
              attrs: {
                url: {
                  type: 'static',
                  content: '/playground_assets',
                },
              },
            },
          },
          {
            type: 'element',
            content: {
              elementType: 'Card',
              dependency: {
                type: 'local',
              },
              children: [{ type: 'static', content: 'Test' }],
            },
          },
          {
            type: 'element',
            content: {
              elementType: 'link',
              attrs: {
                url: {
                  type: 'static',
                  content: 'https://random',
                },
              },
              style: {
                color: { type: 'static', content: 'red' },
              },
              children: [{ type: 'static', content: 'click me' }],
            },
          }
        )
      }

      firstlvlchildren.push({
        type: 'element',
        content: {
          elementType: 'container',
          attrs: {
            'data-attr': {
              type: 'static',
              content: 'test',
            },
          },
          children: secondlvlchildren,
          style: {
            fontSize: { type: 'static', content: '15px' },
            margin: { type: 'static', content: '10px' },
          },
        },
      })
    }

    ;(fakeUIDL.node.content as UIDLElement).children.push({
      type: 'element',
      content: {
        elementType: 'text',
        events: {
          onClick: [],
        },
        children: firstlvlchildren,
      },
    })
  }

  return fakeUIDL
}
