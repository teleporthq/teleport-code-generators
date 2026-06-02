import { NodeHandlerGenerator, handlerToString } from '../types'

async function transform_date_time(config: any, context: Record<string, unknown>) {
  const operation = config.operation || 'current-datetime'
  const input = config.input
  const input2 = config.input2
  const amount = config.amount !== undefined ? Number(config.amount) : 0
  const unit = config.unit || 'days'
  const format = config.format || 'iso'
  const part = config.part || 'year'
  const comparison = config.comparison || 'equal'
  const timezone = config.timezone
  const targetTimezone = config.targetTimezone
  const period = config.period || 'day'
  let result: any

  function parseDate(val) {
    if (!val) {
      return new Date()
    }
    if (val instanceof Date) {
      return val
    }
    const d = new Date(val)
    if (isNaN(d.getTime())) {
      return null
    }
    return d
  }

  function formatDate(d, fmt) {
    if (!d) {
      return null
    }
    if (fmt === 'iso') {
      return d.toISOString()
    }
    if (fmt === 'unix') {
      return Math.floor(d.getTime() / 1000)
    }
    if (fmt === 'date-only') {
      return d.toISOString().split('T')[0]
    }
    if (fmt === 'time-only') {
      return d.toISOString().split('T')[1].split('.')[0]
    }
    if (fmt === 'locale') {
      return d.toLocaleString()
    }
    if (fmt === 'locale-date') {
      return d.toLocaleDateString()
    }
    if (fmt === 'locale-time') {
      return d.toLocaleTimeString()
    }
    return d.toISOString()
  }

  function addToDate(d, amt, u) {
    const nd = new Date(d.getTime())
    switch (u) {
      case 'milliseconds':
        nd.setMilliseconds(nd.getMilliseconds() + amt)
        break
      case 'seconds':
        nd.setSeconds(nd.getSeconds() + amt)
        break
      case 'minutes':
        nd.setMinutes(nd.getMinutes() + amt)
        break
      case 'hours':
        nd.setHours(nd.getHours() + amt)
        break
      case 'days':
        nd.setDate(nd.getDate() + amt)
        break
      case 'weeks':
        nd.setDate(nd.getDate() + amt * 7)
        break
      case 'months':
        nd.setMonth(nd.getMonth() + amt)
        break
      case 'years':
        nd.setFullYear(nd.getFullYear() + amt)
        break
      default:
        break
    }
    return nd
  }

  try {
    switch (operation) {
      case 'current-date':
        result = formatDate(new Date(), 'date-only')
        break
      case 'current-time':
        result = formatDate(new Date(), 'time-only')
        break
      case 'current-datetime':
        result = formatDate(new Date(), format)
        break
      case 'add':
        const addDate = parseDate(input)
        if (!addDate) {
          return { result: null, error: 'Invalid date input' }
        }
        result = formatDate(addToDate(addDate, amount, unit), format)
        break
      case 'subtract':
        const subDate = parseDate(input)
        if (!subDate) {
          return { result: null, error: 'Invalid date input' }
        }
        result = formatDate(addToDate(subDate, -amount, unit), format)
        break
      case 'format':
        const fmtDate = parseDate(input)
        if (!fmtDate) {
          return { result: null, error: 'Invalid date input' }
        }
        result = formatDate(fmtDate, format)
        break
      case 'parse':
        const pDate = parseDate(input)
        if (!pDate) {
          return { result: null, error: 'Cannot parse date' }
        }
        result = pDate.toISOString()
        break
      case 'compare':
        const cDate1 = parseDate(input)
        const cDate2 = parseDate(input2)
        if (!cDate1 || !cDate2) {
          return { result: null, error: 'Invalid date input(s)' }
        }
        const t1 = cDate1.getTime()
        const t2 = cDate2.getTime()
        switch (comparison) {
          case 'equal':
            result = t1 === t2
            break
          case 'before':
            result = t1 < t2
            break
          case 'after':
            result = t1 > t2
            break
          case 'same-or-before':
            result = t1 <= t2
            break
          case 'same-or-after':
            result = t1 >= t2
            break
          default:
            result = t1 === t2
        }
        break
      case 'get-part':
        const gpDate = parseDate(input)
        if (!gpDate) {
          return { result: null, error: 'Invalid date input' }
        }
        switch (part) {
          case 'year':
            result = gpDate.getFullYear()
            break
          case 'month':
            result = gpDate.getMonth() + 1
            break
          case 'day':
            result = gpDate.getDate()
            break
          case 'hour':
            result = gpDate.getHours()
            break
          case 'minute':
            result = gpDate.getMinutes()
            break
          case 'second':
            result = gpDate.getSeconds()
            break
          case 'millisecond':
            result = gpDate.getMilliseconds()
            break
          case 'day-of-week':
            result = gpDate.getDay()
            break
          case 'day-of-year':
            const startOfYear = new Date(gpDate.getFullYear(), 0, 0)
            result = Math.floor((gpDate.getTime() - startOfYear.getTime()) / 86400000)
            break
          case 'timestamp':
            result = gpDate.getTime()
            break
          default:
            result = null
        }
        break
      case 'diff':
        const dDate1 = parseDate(input)
        const dDate2 = parseDate(input2)
        if (!dDate1 || !dDate2) {
          return { result: null, error: 'Invalid date input(s)' }
        }
        const diffMs = dDate1.getTime() - dDate2.getTime()
        switch (unit) {
          case 'milliseconds':
            result = diffMs
            break
          case 'seconds':
            result = Math.floor(diffMs / 1000)
            break
          case 'minutes':
            result = Math.floor(diffMs / 60000)
            break
          case 'hours':
            result = Math.floor(diffMs / 3600000)
            break
          case 'days':
            result = Math.floor(diffMs / 86400000)
            break
          case 'weeks':
            result = Math.floor(diffMs / 604800000)
            break
          default:
            result = diffMs
        }
        break
      case 'timezone-convert':
        const tzDate = parseDate(input)
        if (!tzDate) {
          return { result: null, error: 'Invalid date input' }
        }
        try {
          result = tzDate.toLocaleString('en-US', { timeZone: targetTimezone || timezone })
        } catch (e) {
          result = null
        }
        break
      case 'is-valid':
        const ivDate = parseDate(input)
        result = ivDate !== null
        break
      case 'start-of':
        const soDate = parseDate(input)
        if (!soDate) {
          return { result: null, error: 'Invalid date input' }
        }
        const startOf = new Date(soDate.getTime())
        switch (period) {
          case 'day':
            startOf.setHours(0, 0, 0, 0)
            break
          case 'month':
            startOf.setDate(1)
            startOf.setHours(0, 0, 0, 0)
            break
          case 'year':
            startOf.setMonth(0, 1)
            startOf.setHours(0, 0, 0, 0)
            break
          case 'hour':
            startOf.setMinutes(0, 0, 0)
            break
          case 'minute':
            startOf.setSeconds(0, 0)
            break
          case 'week':
            const dayOfWeek = startOf.getDay()
            startOf.setDate(startOf.getDate() - dayOfWeek)
            startOf.setHours(0, 0, 0, 0)
            break
          default:
            break
        }
        result = formatDate(startOf, format)
        break
      case 'end-of':
        const eoDate = parseDate(input)
        if (!eoDate) {
          return { result: null, error: 'Invalid date input' }
        }
        const endOf = new Date(eoDate.getTime())
        switch (period) {
          case 'day':
            endOf.setHours(23, 59, 59, 999)
            break
          case 'month':
            endOf.setMonth(endOf.getMonth() + 1, 0)
            endOf.setHours(23, 59, 59, 999)
            break
          case 'year':
            endOf.setMonth(11, 31)
            endOf.setHours(23, 59, 59, 999)
            break
          case 'hour':
            endOf.setMinutes(59, 59, 999)
            break
          case 'minute':
            endOf.setSeconds(59, 999)
            break
          case 'week':
            const eoDow = endOf.getDay()
            endOf.setDate(endOf.getDate() + (6 - eoDow))
            endOf.setHours(23, 59, 59, 999)
            break
          default:
            break
        }
        result = formatDate(endOf, format)
        break
      case 'is-weekend':
        const wkDate = parseDate(input)
        if (!wkDate) {
          return { result: null, error: 'Invalid date input' }
        }
        const dow = wkDate.getDay()
        result = dow === 0 || dow === 6
        break
      case 'is-business-day':
        const bdDate = parseDate(input)
        if (!bdDate) {
          return { result: null, error: 'Invalid date input' }
        }
        const bdDow = bdDate.getDay()
        result = bdDow >= 1 && bdDow <= 5
        break
      default:
        return { result: null, error: 'Unknown operation: ' + operation }
    }

    return { result }
  } catch (err: unknown) {
    return { result: null, error: (err as Error).message }
  }
}
export const transformDateTime: NodeHandlerGenerator = {
  nodeType: 'transform-date-time',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(transform_date_time)
  },
}
