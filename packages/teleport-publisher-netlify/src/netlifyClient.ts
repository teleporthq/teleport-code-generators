import fetch from 'cross-fetch'
import ZipPublisher from '@teleporthq/teleport-publisher-zip'
import { GeneratedFolder } from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { CANNOT_ZIP_PROJECT } from './errors'
import { NETLIFY_BASE_URL } from './constants'

export const deployToNetlify = async (
  project: GeneratedFolder,
  accessToken: string
): Promise<string> => {
  const zipContent = await ZipPublisher({ project }).publish()
  if (!zipContent.success) {
    throw new Error(CANNOT_ZIP_PROJECT)
  }

  const createdSiteId = await createSite(accessToken, project.name)
  return createSiteDeploy(zipContent.payload, accessToken, createdSiteId)
}

const createSite = async (accessToken: string, siteName: string): Promise<string> => {
  const params = new URLSearchParams()
  params.append('name', siteName)

  const response = await fetch(`${NETLIFY_BASE_URL}/sites`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: params,
  })

  if (response.status !== 200) {
    throw new Error(response.statusText)
  }

  const siteData = await response.json()
  return siteData.id
}

const createSiteDeploy = async (
  zipFile: string | Blob | Buffer,
  accessToken: string,
  siteId: string
): Promise<string> => {
  const url = `${NETLIFY_BASE_URL}/sites/${siteId}/deploys`

  const response = await fetch(url, {
    method: 'POST',
    body: zipFile,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application.zip',
    },
  })

  const result = await response.json()
  return result.url
}
