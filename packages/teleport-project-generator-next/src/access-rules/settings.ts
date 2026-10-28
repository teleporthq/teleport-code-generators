import { ProjectUIDL, UIDLPluginSettingValue } from '@teleporthq/teleport-types'

/**
 * The Age gate & geo block plugin's settings as the editor stores them
 * (`features/plugins/registry/definitions/access-rules.ts` there). The editor
 * writes every field it has, so the defaults here are a safety net for a
 * record an older editor wrote; every value is still checked, since the
 * published site bakes them into code. The gate's words live on the editor's
 * Age Gate component, not here.
 */

const ACCESS_RULES_PLUGIN_KEY = 'accessRules'

export interface AccessRulesSettings {
  ageGateEnabled: boolean
  minimumAge: number
  ageGateMode: 'confirm' | 'birthdate'
  ageGateScope: 'site' | 'pages'
  rememberDays: number
  allowCrawlers: boolean
  geoMode: 'off' | 'block' | 'allow'
  /** Upper-case ISO 3166-1 alpha-2 codes. */
  geoCountries: string[]
  geoUnknownCountry: 'allow' | 'block'
}

const DEFAULTS: AccessRulesSettings = {
  ageGateEnabled: true,
  minimumAge: 18,
  ageGateMode: 'confirm',
  ageGateScope: 'site',
  rememberDays: 30,
  allowCrawlers: true,
  geoMode: 'off',
  geoCountries: [],
  geoUnknownCountry: 'allow',
}

type Stored = Record<string, UIDLPluginSettingValue | undefined>

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const integer = (value: unknown, fallback: number, min: number, max: number): number => {
  const rounded = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, rounded))
}

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []

/** `/shop` or `/shop/*`: a path, lower-cased, with no trailing slash. */
const pagePath = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || /\s/.test(trimmed)) {
    return null
  }
  const withoutSlash = trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed
  return withoutSlash.toLowerCase()
}

const countryCode = (value: string): string | null =>
  /^[A-Za-z]{2}$/.test(value.trim()) ? value.trim().toUpperCase() : null

/** The plugin's settings when the project has it on; null otherwise. */
export const resolveAccessRulesSettings = (uidl: ProjectUIDL): AccessRulesSettings | null => {
  const record = uidl.plugins?.[ACCESS_RULES_PLUGIN_KEY]
  if (
    !record ||
    typeof record !== 'object' ||
    !record.settings ||
    typeof record.settings !== 'object'
  ) {
    return null
  }
  const stored = record.settings as Stored
  const minimumAge = integer(stored.minimumAge, DEFAULTS.minimumAge, 13, 25)
  return {
    ageGateEnabled: bool(stored.ageGateEnabled, DEFAULTS.ageGateEnabled),
    minimumAge,
    ageGateMode: oneOf(stored.ageGateMode, ['confirm', 'birthdate'], DEFAULTS.ageGateMode),
    ageGateScope: oneOf(stored.ageGateScope, ['site', 'pages'], DEFAULTS.ageGateScope),
    rememberDays: integer(stored.rememberDays, DEFAULTS.rememberDays, 1, 365),
    allowCrawlers: bool(stored.allowCrawlers, DEFAULTS.allowCrawlers),
    geoMode: oneOf(stored.geoMode, ['off', 'block', 'allow'], DEFAULTS.geoMode),
    geoCountries: Array.from(
      new Set(
        stringList(stored.geoCountries)
          .map(countryCode)
          .filter((code): code is string => code !== null)
      )
    ),
    geoUnknownCountry: oneOf(
      stored.geoUnknownCountry,
      ['allow', 'block'],
      DEFAULTS.geoUnknownCountry
    ),
  }
}

/**
 * What the editor exports beside the settings (`uidl.plugins.accessRules.data`
 * and `.pages`): whether the project has the editor's Age Gate component
 * (without it there is no gate to drive), the gated paths as served, the
 * Unavailable page's paths as served (the gate never covers it) and its route
 * (without it a blocked visitor gets a plain notice).
 */
export interface AccessRulesRuntime {
  gate: 'component' | 'none'
  gatedPaths: string[]
  unavailablePaths: string[]
  unavailableRoute: string | null
}

/** The paths an export lists, each as the head script compares them; anything else is dropped. */
const exportedPaths = (value: unknown): string[] =>
  Array.from(
    new Set(
      stringList(value)
        .map(pagePath)
        .filter((path): path is string => path !== null)
    )
  )

export const resolveAccessRulesRuntime = (uidl: ProjectUIDL): AccessRulesRuntime => {
  const record = uidl.plugins?.[ACCESS_RULES_PLUGIN_KEY]
  const data =
    record && typeof record === 'object' && record.data && typeof record.data === 'object'
      ? (record.data as Record<string, unknown>)
      : {}
  const unavailable = record?.pages?.unavailable
  return {
    gate: data.gate === 'component' ? 'component' : 'none',
    gatedPaths: exportedPaths(data.gatedPaths),
    unavailablePaths: exportedPaths(data.unavailablePaths),
    unavailableRoute:
      typeof unavailable === 'string' && unavailable.startsWith('/') ? unavailable : null,
  }
}

/** The gate has somewhere to show: the whole site, or at least one gated path. */
export const ageGateActive = (
  settings: AccessRulesSettings,
  runtime: AccessRulesRuntime
): boolean =>
  settings.ageGateEnabled && (settings.ageGateScope === 'site' || runtime.gatedPaths.length > 0)

/** A country rule with at least one country does something. */
export const geoRulesActive = (settings: AccessRulesSettings): boolean =>
  settings.geoMode !== 'off' && settings.geoCountries.length > 0
