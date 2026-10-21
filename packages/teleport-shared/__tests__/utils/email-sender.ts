import {
  EmailSenderInput,
  EmailSenderParts,
  generateEmailSenderHelperCode,
} from '../../src/utils/email-sender'

/**
 * The one rule every generated email path names its sender with. Executed, not
 * grepped: the helper ships as source text whose regexes are written with
 * doubled backslashes inside a template literal, so only running it proves
 * them.
 */

const emailSender = new Function(`${generateEmailSenderHelperCode()}\nreturn __emailSender;`)() as (
  sender: EmailSenderInput
) => EmailSenderParts

const FROM = 'shop@lumen.test'

const ROWS: Array<[string, EmailSenderInput, EmailSenderParts]> = [
  [
    'a plain name',
    { from: FROM, name: 'Lumen Pottery' },
    { email: FROM, name: 'Lumen Pottery', header: 'Lumen Pottery <shop@lumen.test>' },
  ],
  ['no name', { from: FROM }, { email: FROM, name: '', header: FROM }],
  ['a blank name', { from: FROM, name: '   ' }, { email: FROM, name: '', header: FROM }],
  [
    'a name with a comma and a quote',
    { from: FROM, name: 'Smith, Jones & "Co"' },
    {
      email: FROM,
      name: 'Smith, Jones & "Co"',
      header: '"Smith, Jones & \\"Co\\"" <shop@lumen.test>',
    },
  ],
  [
    'a name with a backslash',
    { from: FROM, name: 'Back\\slash' },
    { email: FROM, name: 'Back\\slash', header: '"Back\\\\slash" <shop@lumen.test>' },
  ],
  [
    'a name ending in a full stop',
    { from: FROM, name: 'Lumen Pottery Ltd.' },
    { email: FROM, name: 'Lumen Pottery Ltd.', header: '"Lumen Pottery Ltd." <shop@lumen.test>' },
  ],
  [
    'a from that already names its sender keeps that name',
    { from: 'Lumen Pottery <shop@lumen.test>', name: 'Another Name' },
    { email: FROM, name: 'Lumen Pottery', header: 'Lumen Pottery <shop@lumen.test>' },
  ],
  [
    'an already quoted from is left as it is',
    { from: '"Smith, Jones" <shop@lumen.test>' },
    { email: FROM, name: 'Smith, Jones', header: '"Smith, Jones" <shop@lumen.test>' },
  ],
  [
    'a from whose own name needs quotes gets them',
    { from: 'Smith, Jones <shop@lumen.test>' },
    { email: FROM, name: 'Smith, Jones', header: '"Smith, Jones" <shop@lumen.test>' },
  ],
  [
    'a bracketed address with no name of its own takes the stored name',
    { from: '<shop@lumen.test>', name: 'Lumen Pottery' },
    { email: FROM, name: 'Lumen Pottery', header: 'Lumen Pottery <shop@lumen.test>' },
  ],
  [
    'a line break in the name becomes a space',
    { from: FROM, name: 'Lumen\r\nBcc: someone@else.test' },
    {
      email: FROM,
      name: 'Lumen Bcc: someone@else.test',
      header: '"Lumen Bcc: someone@else.test" <shop@lumen.test>',
    },
  ],
  [
    'a name typed with its own quotes is not quoted twice',
    { from: FROM, name: '"Lumen Pottery"' },
    { email: FROM, name: 'Lumen Pottery', header: 'Lumen Pottery <shop@lumen.test>' },
  ],
  [
    'a non-ASCII name needs no quotes',
    { from: FROM, name: 'Café Lumière' },
    { email: FROM, name: 'Café Lumière', header: 'Café Lumière <shop@lumen.test>' },
  ],
  [
    'surrounding whitespace is trimmed',
    { from: '  shop@lumen.test ', name: ' Lumen ' },
    { email: FROM, name: 'Lumen', header: 'Lumen <shop@lumen.test>' },
  ],
  [
    'an address it cannot read is never wrapped',
    { from: 'shop@lumen.test>', name: 'Lumen' },
    { email: 'shop@lumen.test>', name: '', header: 'shop@lumen.test>' },
  ],
  [
    'a name that is not text is ignored',
    { from: FROM, name: { first: 'Lumen' } },
    { email: FROM, name: '', header: FROM },
  ],
  ['no address', { name: 'Lumen' }, { email: '', name: '', header: '' }],
]

describe('__emailSender', () => {
  it.each(ROWS)('%s', (_label, input, expected) => {
    expect(emailSender(input)).toEqual(expected)
  })

  it('quotes a name holding any RFC 5322 special, escaping only " and \\', () => {
    for (const special of ['(', ')', '<', '>', '[', ']', ':', ';', '@', '\\', ',', '.', '"']) {
      const escaped = special === '"' || special === '\\' ? '\\' + special : special
      expect(emailSender({ from: FROM, name: `A${special}B` }).header).toBe(
        `"A${escaped}B" <shop@lumen.test>`
      )
    }
  })

  // Appended to node handlers whose minified entry point is found by arity.
  it('declares exactly one parameter, and no two-parameter function', () => {
    expect(emailSender.length).toBe(1)
    expect(generateEmailSenderHelperCode()).not.toMatch(/function\s*[\w$]*\s*\([^)]*,/)
  })
})
