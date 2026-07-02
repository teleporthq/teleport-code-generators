// Pins the file-storage-upload contract the tq-form-file-input primitive
// relies on: the form-submit workflow does state-get-local-state(<state>) ->
// file-storage-upload(file = <PickedFile[]>), so the handler must accept an
// ARRAY of `{ name, size, type, lastModified, dataURL }` POJOs (the exact
// shape browser-pick-files emits) and convert every dataURL to a Blob before
// POSTing the FormData.

import { Blob as NodeBlob } from 'buffer'
import { loadHandler, HandlerFn } from './_helpers/load-handler'

// jest 26's node sandbox exposes none of the browser upload globals the
// handler uses (FormData/Blob/atob/fetch), so the test installs minimal
// stand-ins: Node's own Blob, a Buffer-backed atob, and a FormData stub
// that records appends the way the assertions need them.
class FormDataStub {
  public appended: Array<{ key: string; value: unknown; fileName?: string }> = []

  public append(key: string, value: unknown, fileName?: string): void {
    this.appended.push({ key, value, fileName })
  }

  public getAll(key: string): Array<{ value: unknown; fileName?: string }> {
    return this.appended
      .filter((entry) => entry.key === key)
      .map((entry) => ({ value: entry.value, fileName: entry.fileName }))
  }
}

const toDataURL = (mime: string, content: string): string =>
  `data:${mime};base64,${Buffer.from(content).toString('base64')}`

const blobText = async (value: unknown): Promise<string> =>
  Buffer.from(await (value as InstanceType<typeof NodeBlob>).arrayBuffer()).toString()

describe('file-storage-upload: PickedFile array from state', () => {
  let fetchMock: jest.Mock
  let handler: HandlerFn

  beforeEach(() => {
    handler = loadHandler('file-storage-upload')
    fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        files: [
          { id: '1', name: 'a.png', url: 'https://storage.example/a.png' },
          { id: '2', name: 'b.txt', url: 'https://storage.example/b.txt' },
        ],
      }),
    }))
    ;(globalThis as any).fetch = fetchMock
    ;(globalThis as any).FormData = FormDataStub
    ;(globalThis as any).Blob = NodeBlob
    ;(globalThis as any).atob = (encoded: string) =>
      Buffer.from(encoded, 'base64').toString('binary')
  })

  afterEach(() => {
    delete (globalThis as any).fetch
    delete (globalThis as any).FormData
    delete (globalThis as any).Blob
    delete (globalThis as any).atob
  })

  it('converts every PickedFile dataURL to a Blob and appends all of them', async () => {
    const pickedFiles = [
      {
        name: 'a.png',
        size: 9,
        type: 'image/png',
        lastModified: 1,
        dataURL: toDataURL('image/png', 'png-bytes'),
      },
      {
        name: 'b.txt',
        size: 9,
        type: 'text/plain',
        lastModified: 2,
        dataURL: toDataURL('text/plain', 'txt-bytes'),
      },
    ]

    const result = (await handler({ file: pickedFiles }, {})) as { files: Array<{ url: string }> }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/runtime-storage/upload')
    const entries = (init.body as FormDataStub).getAll('file')
    expect(entries).toHaveLength(2)
    expect(entries[0].fileName).toBe('a.png')
    expect((entries[0].value as InstanceType<typeof NodeBlob>).type).toBe('image/png')
    expect(await blobText(entries[0].value)).toBe('png-bytes')
    expect(entries[1].fileName).toBe('b.txt')
    expect((entries[1].value as InstanceType<typeof NodeBlob>).type).toBe('text/plain')
    expect(await blobText(entries[1].value)).toBe('txt-bytes')

    expect(result.files.map((f) => f.url)).toEqual([
      'https://storage.example/a.png',
      'https://storage.example/b.txt',
    ])
  })

  it('skips array entries without a usable dataURL but uploads the rest', async () => {
    const pickedFiles = [
      { name: 'broken.png', size: 1, type: 'image/png', lastModified: 1 },
      {
        name: 'ok.png',
        size: 9,
        type: 'image/png',
        lastModified: 2,
        dataURL: toDataURL('image/png', 'ok-bytes'),
      },
    ]

    await handler({ file: pickedFiles }, {})

    const entries = (fetchMock.mock.calls[0][1].body as FormDataStub).getAll('file')
    expect(entries).toHaveLength(1)
    expect(entries[0].fileName).toBe('ok.png')
  })

  it('returns an error without fetching when no array entry is convertible', async () => {
    const result = await handler({ file: [{ name: 'x.png', type: 'image/png' }] }, {})

    expect(result).toEqual({ files: [], error: 'Invalid file data' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never throws for an empty selection — the submit chain needs no if-gate', async () => {
    // An untouched form-file-input state is [] and reaches the node as-is.
    const result = await handler({ file: [] }, {})

    expect(result).toEqual({ files: [], error: 'Invalid file data' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
