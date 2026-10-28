import type { UIDLCompanyDetails } from '@teleporthq/teleport-types'

const COMPANY_GLOBAL_KEYS = [
  'companyName',
  'companyAddress',
  'companyCity',
  'companyState',
  'companyZip',
  'companyCountry',
  'companyVat',
  'companyRegNumber',
  'companyEmail',
  'companyPhone',
  'companyWebsite',
] as const

/** The object a published `company.companyName` binding reads. Text fields only. */
export const companyGlobalObject = (
  details?: Partial<UIDLCompanyDetails> | null
): Record<(typeof COMPANY_GLOBAL_KEYS)[number], string> => {
  const company = {} as Record<(typeof COMPANY_GLOBAL_KEYS)[number], string>
  for (const key of COMPANY_GLOBAL_KEYS) {
    const value = details?.[key]
    company[key] = value == null ? '' : String(value)
  }
  return company
}
