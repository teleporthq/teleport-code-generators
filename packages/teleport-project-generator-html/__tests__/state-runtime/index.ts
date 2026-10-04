import { load } from 'cheerio'
import { FileType, GeneratedFile, GeneratedFolder } from '@teleporthq/teleport-types'
import { fileOf, generateSite, plainSite, stateSite } from '../_helpers/state-site'
import { STATE_RUNTIME_CSS } from '../../src/state/runtime-script'

const allFiles = (folder: GeneratedFolder): GeneratedFile[] => [
  ...folder.files,
  ...folder.subFolders.flatMap(allFiles),
]

const RUNTIME_LINK = /<script defer src="\.\/tq-state\.js"><\/script>/g

describe('State bindings in the static HTML export', () => {
  it('writes every branch, and hides exactly the ones the page does not start on', async () => {
    const $ = load(fileOf(await generateSite(stateSite()), 'index', FileType.HTML))
    const ids = (selector: string) =>
      $(selector)
        .map((_, element) => $(element).attr('id'))
        .get()
        .sort()

    expect(ids('[data-tq-if]')).toEqual(
      [
        'burger-close',
        'burger-close',
        'burger-open',
        'burger-open',
        'menu',
        'menu',
        'panel-0',
        'panel-1',
        'panel-2',
        'price-monthly',
        'price-yearly',
        'slot-badge',
      ].sort()
    )
    expect(ids('[hidden]')).toEqual(
      [
        'burger-close',
        'burger-close',
        'menu',
        'menu',
        'panel-1',
        'panel-2',
        'price-yearly',
        'slot-badge',
      ].sort()
    )
    expect($('#menu').first().attr('data-tq-if')).toBe('menuOpen')
    expect($('#burger-open').first().attr('data-tq-if')).toBe('!menuOpen')
    expect($('#panel-2').attr('data-tq-if')).toBe('activeTabIndex === 2')
    expect($('#price-yearly').attr('data-tq-if')).toBe('yearly')
  })

  it('gives the page and each Navigation instance a store of their own', async () => {
    const $ = load(fileOf(await generateSite(stateSite()), 'index', FileType.HTML))

    const scopes = $('[data-tq-scope]')
      .map(
        (_, element) => `${$(element).attr('data-tq-scope')}: ${$(element).attr('data-tq-state')}`
      )
      .get()
    expect(scopes).toEqual([
      'Home: activeTabIndex = 0; yearly = false',
      'Navigation: menuOpen = false',
      'Navigation: menuOpen = false',
    ])
    const [firstNavigation, secondNavigation] = $('[data-tq-scope="Navigation"]').toArray()
    expect($(firstNavigation).find('#burger').attr('data-tq-on-click')).toBe('menuOpen = !menuOpen')
    expect($(secondNavigation).find('#burger').attr('data-tq-on-click')).toBe(
      'menuOpen = !menuOpen'
    )
    // what the page put into the first Navigation reads the page's store
    expect($(firstNavigation).find('[data-tq-slot] #slot-badge').attr('data-tq-if')).toBe('yearly')
    expect($(secondNavigation).find('[data-tq-slot]').length).toBe(0)
  })

  it("a condition around a component instance is the parent's, the instance keeps its own store", async () => {
    const uidl = stateSite() as any
    const homeChildren = uidl.root.node.content.children[0].content.node.content.children
    homeChildren.push({
      type: 'conditional',
      content: {
        reference: { type: 'dynamic', content: { referenceType: 'state', id: 'yearly' } },
        condition: { conditions: [{ operation: '===', operand: true }] },
        node: {
          type: 'element',
          content: {
            elementType: 'component',
            semanticType: 'Navigation',
            dependency: { type: 'local' },
          },
        },
      },
    })
    const $ = load(fileOf(await generateSite(uidl), 'index', FileType.HTML))

    const conditional = $('[data-tq-scope="Navigation"][data-tq-if]')
    expect(conditional.length).toBe(1)
    expect(conditional.attr('data-tq-if')).toBe('yearly')
    expect(conditional.attr('hidden')).toBeDefined()
    expect(conditional.attr('data-tq-state')).toBe('menuOpen = false')
  })

  it('compiles the clicks and the tab workflows, and the active class follows the tab', async () => {
    const $ = load(fileOf(await generateSite(stateSite()), 'index', FileType.HTML))

    const burger = $('#burger').first()
    expect(burger.attr('role')).toBe('button')
    expect(burger.attr('tabindex')).toBe('0')
    const billing = $('#billing-switch')
    expect(billing.attr('data-tq-on-click')).toBe('yearly = !yearly')
    expect(billing.attr('role')).toBeUndefined()
    ;[0, 1, 2].forEach((index) => {
      const trigger = $(`#tab-${index}`)
      expect(trigger.attr('data-tq-on-click')).toBe(`activeTabIndex = ${index}`)
      expect(trigger.attr('data-tq-class')).toBe(`tab-active: activeTabIndex === ${index}`)
      expect(trigger.hasClass('tab-active')).toBe(index === 0)
    })
  })

  it('ships the runtime once, linked once from the head of the pages that use it', async () => {
    const site = await generateSite(stateSite())
    const runtimes = allFiles(site).filter((file) => file.name === 'tq-state')
    expect(runtimes).toHaveLength(1)
    expect(runtimes[0].fileType).toBe(FileType.JS)
    expect(site.files).toContain(runtimes[0])
    expect(Buffer.byteLength(runtimes[0].content)).toBeLessThan(8000)
    // the maintainers' notes stay out of the visitor's download
    expect(runtimes[0].content.split('\n').some((line) => /^\s*\/\//.test(line))).toBe(false)
    expect(runtimes[0].content).not.toMatch(/\beval\b|new Function/)

    const home = fileOf(site, 'index', FileType.HTML)
    expect(home.match(RUNTIME_LINK)).toHaveLength(1)
    expect(home.search(RUNTIME_LINK)).toBeLessThan(home.indexOf('</head>'))
    expect(fileOf(site, 'about', FileType.HTML)).not.toContain('tq-state')

    const css = fileOf(site, 'style', FileType.CSS)
    expect(css.split(STATE_RUNTIME_CSS.trim())).toHaveLength(2)

    // the component exported as a document of its own sits one folder down
    site.subFolders
      .flatMap((folder) => folder.files)
      .filter((file) => file.fileType === FileType.HTML && file.content.includes('data-tq-scope'))
      .forEach((file) => {
        if (file.content.includes('</head>')) {
          expect(file.content).toContain('<script defer src="../tq-state.js"></script>')
        } else {
          expect(file.content).not.toContain('tq-state.js')
        }
      })
  })

  it('links the runtime in a head that closes the strict way', async () => {
    const site = await generateSite(stateSite(), { strictHtmlWhitespaceSensitivity: true })
    const home = fileOf(site, 'index', FileType.HTML)

    expect(home).toMatch(/<\/head\s+>/)
    expect(home.match(RUNTIME_LINK)).toHaveLength(1)
    expect(home.search(RUNTIME_LINK)).toBeLessThan(home.search(/<\/head\s*>/))
    expect(load(home)('#panel-1').attr('hidden')).toBeDefined()
  })

  it('adds nothing to a project without state bindings', async () => {
    const site = await generateSite(plainSite())

    expect(allFiles(site).some((file) => file.name === 'tq-state')).toBe(false)
    allFiles(site).forEach((file) => {
      expect(file.content).not.toContain('data-tq-')
      expect(file.content).not.toContain('tq-state')
    })
  })
})
