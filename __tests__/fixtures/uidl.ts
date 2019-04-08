// @ts-ignore
import bigUIDL from './big-sample.json'

export const createUIDL = (
  params: { firstLvl?: number; secondLvl?: number; thirdLvl?: number } = {}
) => {
  const { firstLvl = 100, secondLvl = 10, thirdLvl = 2 } = params
  const fakeUIDL = JSON.parse(JSON.stringify(bigUIDL))
  for (let index = 0; index < firstLvl; index++) {
    const firstlvlchildren = []
    for (let index2 = 0; index2 < secondLvl; index2++) {
      const secondlvlchildren = []
      for (let index3 = 0; index3 < thirdLvl; index3++) {
        secondlvlchildren.push(
          {
            type: 'image',
            attrs: {
              url: '/playground_assets',
            },
          },
          {
            type: 'Card',
            dependency: {
              type: 'local',
            },
            children: ['Test'],
          },
          {
            type: 'link',
            attrs: {
              url: 'https://random',
            },
            style: {
              color: 'red',
            },
            children: ['click me'],
          }
        )
      }

      firstlvlchildren.push({
        type: 'container',
        attrs: {
          'data-attr': 'test',
        },
        children: secondlvlchildren,
        style: {
          fontSize: '15px',
          margin: '10px',
        },
      })
    }

    fakeUIDL.content.children.push({
      type: 'text',
      events: {
        onClick: [],
      },
      children: firstlvlchildren,
    })
  }

  return fakeUIDL
}
