import { IntegrationHandlerGenerator } from '../types'

import { integrationActivecampaign } from './integration-activecampaign'
import { integrationAirtable } from './integration-airtable'
import { integrationAmazonS3 } from './integration-amazon-s3'
import { integrationAmplitude } from './integration-amplitude'
import { integrationApollo } from './integration-apollo'
import { integrationAsana } from './integration-asana'
import { integrationAshby } from './integration-ashby'
import { integrationAtlassian } from './integration-atlassian'
import { integrationBamboohr } from './integration-bamboohr'
import { integrationBannerbear } from './integration-bannerbear'
import { integrationBasecamp } from './integration-basecamp'
import { integrationBeeminder } from './integration-beeminder'
import { integrationBitbucket } from './integration-bitbucket'
import { integrationCalendly } from './integration-calendly'
import { integrationClickup } from './integration-clickup'
import { integrationCoda } from './integration-coda'
import { integrationConfluence } from './integration-confluence'
import { integrationCopper } from './integration-copper'
import { integrationDiscord } from './integration-discord'
import { integrationDocusign } from './integration-docusign'
import { integrationDropboxSign } from './integration-dropbox-sign'
import { integrationDropbox } from './integration-dropbox'
import { integrationEventbrite } from './integration-eventbrite'
import { integrationExcel } from './integration-excel'
import { integrationFacebook } from './integration-facebook'
import { integrationFigma } from './integration-figma'
import { integrationGainsight } from './integration-gainsight'
import { integrationGithub } from './integration-github'
import { integrationGmail } from './integration-gmail'
import { integrationGong } from './integration-gong'
import { integrationGoogleAnalytics } from './integration-google-analytics'
import { integrationGoogleBigquery } from './integration-google-bigquery'
import { integrationGoogleCalendar } from './integration-google-calendar'
import { integrationGoogleDocs } from './integration-google-docs'
import { integrationGoogleDrive } from './integration-google-drive'
import { integrationGoogleMaps } from './integration-google-maps'
import { integrationGoogleSheets } from './integration-google-sheets'
import { integrationGreenhouse } from './integration-greenhouse'
import { integrationHeap } from './integration-heap'
import { integrationHive } from './integration-hive'
import { integrationHotjar } from './integration-hotjar'
import { integrationHubspot } from './integration-hubspot'
import { integrationInsightly } from './integration-insightly'
import { integrationInsomnia } from './integration-insomnia'
import { integrationIntercom } from './integration-intercom'
import { integrationJira } from './integration-jira'
import { integrationKeap } from './integration-keap'
import { integrationLever } from './integration-lever'
import { integrationLinear } from './integration-linear'
import { integrationLooker } from './integration-looker'
import { integrationMailchimp } from './integration-mailchimp'
import { integrationMiro } from './integration-miro'
import { integrationMixpanel } from './integration-mixpanel'
import { integrationMonday } from './integration-monday'
import { integrationNetsuite } from './integration-netsuite'
import { integrationNotion } from './integration-notion'
import { integrationOracle } from './integration-oracle'
import { integrationOutlook } from './integration-outlook'
import { integrationOutreach } from './integration-outreach'
import { integrationPandadoc } from './integration-pandadoc'
import { integrationPardot } from './integration-pardot'
import { integrationPipedrive } from './integration-pipedrive'
import { integrationPostman } from './integration-postman'
import { integrationPowerbi } from './integration-powerbi'
import { integrationProductboard } from './integration-productboard'
import { integrationQuickbooks } from './integration-quickbooks'
import { integrationRapidapi } from './integration-rapidapi'
import { integrationSalesforce } from './integration-salesforce'
import { integrationSegment } from './integration-segment'
import { integrationSentry } from './integration-sentry'
import { integrationSerpApi } from './integration-serp-api'
import { integrationShopify } from './integration-shopify'
import { integrationSlack } from './integration-slack'
import { integrationSmartsheet } from './integration-smartsheet'
import { integrationSnowflake } from './integration-snowflake'
import { integrationStripe } from './integration-stripe'
import { integrationTableau } from './integration-tableau'
import { integrationTavily } from './integration-tavily'
import { integrationTrello } from './integration-trello'
import { integrationTypeform } from './integration-typeform'
import { integrationWhatsapp } from './integration-whatsapp'
import { integrationWoocommerce } from './integration-woocommerce'
import { integrationWorkable } from './integration-workable'
import { integrationWrike } from './integration-wrike'
import { integrationX } from './integration-x'
import { integrationXero } from './integration-xero'
import { integrationYoutube } from './integration-youtube'
import { integrationZendesk } from './integration-zendesk'

export const integrationRegistry: Record<string, IntegrationHandlerGenerator> = {
  'integration-activecampaign': integrationActivecampaign,
  'integration-airtable': integrationAirtable,
  'integration-amazon-s3': integrationAmazonS3,
  'integration-amplitude': integrationAmplitude,
  'integration-apollo': integrationApollo,
  'integration-asana': integrationAsana,
  'integration-ashby': integrationAshby,
  'integration-atlassian': integrationAtlassian,
  'integration-bamboohr': integrationBamboohr,
  'integration-bannerbear': integrationBannerbear,
  'integration-basecamp': integrationBasecamp,
  'integration-beeminder': integrationBeeminder,
  'integration-bitbucket': integrationBitbucket,
  'integration-calendly': integrationCalendly,
  'integration-clickup': integrationClickup,
  'integration-coda': integrationCoda,
  'integration-confluence': integrationConfluence,
  'integration-copper': integrationCopper,
  'integration-discord': integrationDiscord,
  'integration-docusign': integrationDocusign,
  'integration-dropbox-sign': integrationDropboxSign,
  'integration-dropbox': integrationDropbox,
  'integration-eventbrite': integrationEventbrite,
  'integration-excel': integrationExcel,
  'integration-facebook': integrationFacebook,
  'integration-figma': integrationFigma,
  'integration-gainsight': integrationGainsight,
  'integration-github': integrationGithub,
  'integration-gmail': integrationGmail,
  'integration-gong': integrationGong,
  'integration-google-analytics': integrationGoogleAnalytics,
  'integration-google-bigquery': integrationGoogleBigquery,
  'integration-google-calendar': integrationGoogleCalendar,
  'integration-google-docs': integrationGoogleDocs,
  'integration-google-drive': integrationGoogleDrive,
  'integration-google-maps': integrationGoogleMaps,
  'integration-google-sheets': integrationGoogleSheets,
  'integration-greenhouse': integrationGreenhouse,
  'integration-heap': integrationHeap,
  'integration-hive': integrationHive,
  'integration-hotjar': integrationHotjar,
  'integration-hubspot': integrationHubspot,
  'integration-insightly': integrationInsightly,
  'integration-insomnia': integrationInsomnia,
  'integration-intercom': integrationIntercom,
  'integration-jira': integrationJira,
  'integration-keap': integrationKeap,
  'integration-lever': integrationLever,
  'integration-linear': integrationLinear,
  'integration-looker': integrationLooker,
  'integration-mailchimp': integrationMailchimp,
  'integration-miro': integrationMiro,
  'integration-mixpanel': integrationMixpanel,
  'integration-monday': integrationMonday,
  'integration-netsuite': integrationNetsuite,
  'integration-notion': integrationNotion,
  'integration-oracle': integrationOracle,
  'integration-outlook': integrationOutlook,
  'integration-outreach': integrationOutreach,
  'integration-pandadoc': integrationPandadoc,
  'integration-pardot': integrationPardot,
  'integration-pipedrive': integrationPipedrive,
  'integration-postman': integrationPostman,
  'integration-powerbi': integrationPowerbi,
  'integration-productboard': integrationProductboard,
  'integration-quickbooks': integrationQuickbooks,
  'integration-rapidapi': integrationRapidapi,
  'integration-salesforce': integrationSalesforce,
  'integration-segment': integrationSegment,
  'integration-sentry': integrationSentry,
  'integration-serp-api': integrationSerpApi,
  'integration-shopify': integrationShopify,
  'integration-slack': integrationSlack,
  'integration-smartsheet': integrationSmartsheet,
  'integration-snowflake': integrationSnowflake,
  'integration-stripe': integrationStripe,
  'integration-tableau': integrationTableau,
  'integration-tavily': integrationTavily,
  'integration-trello': integrationTrello,
  'integration-typeform': integrationTypeform,
  'integration-whatsapp': integrationWhatsapp,
  'integration-woocommerce': integrationWoocommerce,
  'integration-workable': integrationWorkable,
  'integration-wrike': integrationWrike,
  'integration-x': integrationX,
  'integration-xero': integrationXero,
  'integration-youtube': integrationYoutube,
  'integration-zendesk': integrationZendesk,
}
