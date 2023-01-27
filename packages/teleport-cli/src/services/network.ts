import fetch from 'node-fetch'
import { BASE_URL, UUDID_REGEX, HOST_NAME_MAP } from '../constants'

export const fetchUIDLFromREPL = async (url: string): Promise<Record<string, unknown>> => {
  const id = url.match(UUDID_REGEX)[0]
  const result = await fetch(`${BASE_URL}fetch-uidl/${id}`)
  if (result.status !== 200) {
    throw new Error(`Failed in fetch UIDL - ${JSON.stringify(result, null, 2)}`)
  }
  const jsonData = await result.json()
  return JSON.parse(jsonData.uidl)
}

export const fetchSnapshot = async (slug: string, host: string) => {
  try {
    const url = `${HOST_NAME_MAP[host]}/${slug}/snapshot`
    const result = await fetch(url)
    const jsonData = await result.json()
    return jsonData
  } catch (e) {
    /* tslint:disable-next-line:no-console */
    console.error(e)
  }
}
