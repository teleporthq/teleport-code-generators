import { createGenericIntegration } from './integration-generic'

// Linear personal API keys must be sent RAW in the Authorization header (no
// 'Bearer ' prefix); only OAuth access tokens use Bearer. Use the raw scheme.
export const integrationLinear = createGenericIntegration('integration-linear', 'raw')
