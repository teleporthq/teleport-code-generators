/**
 * Generates the TqCountdown wrapper component source.
 *
 * It uses react-countdown (the SAME library the editor canvas drives via
 * `calcTimeDelta`/`zeroPad`) so the published countdown shows identical digits.
 * The markup + class names (.tq-countdown / .tq-countdown-unit /
 * .tq-countdown-value / .tq-countdown-label) match the renderer one-for-one.
 *
 * SSR safety: the live value depends on the visitor's clock, which differs from
 * the server render and would throw a hydration mismatch. The component renders
 * a deterministic placeholder (zeros, same structure) until mounted, then swaps
 * to the live countdown — so hydration matches and ticking starts client-side.
 */
export const generateCountdownComponentCode = (): string => {
  return `import React, { useState, useEffect, useMemo } from 'react'
import Countdown, { zeroPad } from 'react-countdown'

const ALL_UNITS = ['days', 'hours', 'minutes', 'seconds']
const DEFAULT_LABELS = { days: 'Days', hours: 'Hours', minutes: 'Minutes', seconds: 'Seconds' }

const parseCsv = (value) =>
  typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : []

const resolveUnits = (units) => {
  const parsed = parseCsv(units).filter((u) => ALL_UNITS.indexOf(u) !== -1)
  return parsed.length > 0 ? parsed : ALL_UNITS
}

const resolveLabels = (units, labels) => {
  const raw = parseCsv(labels)
  return units.map((u, i) => raw[i] || DEFAULT_LABELS[u] || u)
}

const wrapperStyle = (format) => ({
  display: 'flex',
  alignItems: 'center',
  gap: format === 'inline' ? 0 : 16,
  fontVariantNumeric: 'tabular-nums',
})

const renderSegments = (segments, format) => {
  if (format === 'inline') {
    return (
      <div className="tq-countdown tq-countdown-inline" style={wrapperStyle('inline')}>
        <span className="tq-countdown-value">{segments.map((s) => s.value).join(':')}</span>
      </div>
    )
  }
  return (
    <div className="tq-countdown tq-countdown-blocks" style={wrapperStyle('blocks')}>
      {segments.map((s, i) => (
        <div
          key={i}
          className="tq-countdown-unit"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >
          <span className="tq-countdown-value" style={{ fontSize: '2em', fontWeight: 700, lineHeight: 1 }}>
            {s.value}
          </span>
          {s.label ? (
            <span className="tq-countdown-label" style={{ fontSize: '0.75em', opacity: 0.7 }}>
              {s.label}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

const dateSegments = (timeDelta, units, labels) => {
  const showDays = units.indexOf('days') !== -1
  const hours = showDays ? timeDelta.hours : timeDelta.days * 24 + timeDelta.hours
  const byUnit = {
    days: timeDelta.days,
    hours: hours,
    minutes: timeDelta.minutes,
    seconds: timeDelta.seconds,
  }
  return units.map((unit, i) => ({ value: zeroPad(byUnit[unit] != null ? byUnit[unit] : 0), label: labels[i] || '' }))
}

const TqCountdown = ({
  mode = 'date',
  target,
  from = '100',
  to = '0',
  format = 'blocks',
  units,
  labels,
  onComplete = 'keep-zero',
  completeMessage = '',
  ...rest
}) => {
  const [mounted, setMounted] = useState(false)
  const [numericStart] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setMounted(true)
  }, [])

  // Numeric mode ticks via its own interval.
  useEffect(() => {
    if (mode !== 'numeric') {
      return undefined
    }
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [mode])

  const resolvedUnits = useMemo(() => resolveUnits(units), [units])
  const resolvedLabels = useMemo(() => resolveLabels(resolvedUnits, labels), [resolvedUnits, labels])

  // Deterministic placeholder (zeros) for SSR + first paint, so hydration matches.
  if (!mounted) {
    const zeros =
      mode === 'numeric'
        ? [{ value: String(from), label: resolvedLabels[0] || '' }]
        : resolvedUnits.map((u, i) => ({ value: '00', label: resolvedLabels[i] || '' }))
    return <div {...rest}>{renderSegments(zeros, format)}</div>
  }

  if (mode === 'numeric') {
    const fromN = parseFloat(from) || 0
    const toN = parseFloat(to) || 0
    const elapsed = Math.max(0, Math.floor((now - numericStart) / 1000))
    const current = fromN > toN ? Math.max(toN, fromN - elapsed) : Math.min(toN, fromN + elapsed)
    const completed = current === toN
    if (completed && onComplete === 'hide') {
      return <div {...rest} />
    }
    if (completed && onComplete === 'show-message') {
      return (
        <div {...rest}>
          <span className="tq-countdown-complete">{completeMessage}</span>
        </div>
      )
    }
    return <div {...rest}>{renderSegments([{ value: String(current), label: resolvedLabels[0] || '' }], format)}</div>
  }

  const renderer = ({ days, hours, minutes, seconds, completed }) => {
    if (completed && onComplete === 'hide') {
      return <span className="tq-countdown-complete" />
    }
    if (completed && onComplete === 'show-message') {
      return <span className="tq-countdown-complete">{completeMessage}</span>
    }
    const segments = dateSegments({ days, hours, minutes, seconds }, resolvedUnits, resolvedLabels)
    return renderSegments(segments, format)
  }

  const targetDate = useMemo(() => {
    const d = new Date(target)
    return isNaN(d.getTime()) ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : d
  }, [target])

  return (
    <div {...rest}>
      <Countdown date={targetDate} renderer={renderer} overtime={false} />
    </div>
  )
}

export default TqCountdown
`
}
