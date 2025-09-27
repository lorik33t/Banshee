import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../state/session'

interface StreamingLoaderProps {
  label?: string
  showTimer?: boolean
  startTime?: number
  active?: boolean
}

export function StreamingLoader({ label, showTimer = true, startTime, active }: StreamingLoaderProps) {
  const isStreaming = useSession((s) => s.isStreaming)
  const storeStart = useSession((s) => s.streamingStartTime)
  const model = useSession((s) => s.streamingModel)
  const events = useSession((s) => s.events)
  const lastModelRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (model && model.length > 0) lastModelRef.current = model
  }, [model])

  const [now, setNow] = useState(Date.now())
  const resumeThresholdMs = 2000
  const lastNotVisibleRef = useRef<number>(Date.now())
  const cycleStartRef = useRef<number | undefined>(undefined)
  const prevVisibleRef = useRef<boolean>(false)

  const activeNow = !!(typeof active === 'boolean' ? active : isStreaming)
  const visible = activeNow

  useEffect(() => {
    const prev = prevVisibleRef.current
    if (visible && !prev) {
      const sinceNotVisible = Date.now() - lastNotVisibleRef.current
      if (sinceNotVisible > resumeThresholdMs || !cycleStartRef.current) {
        cycleStartRef.current = Date.now()
      }
    }
    if (!visible && prev) {
      lastNotVisibleRef.current = Date.now()
    }
    prevVisibleRef.current = visible
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [visible])

  const baseStart = (startTime ?? storeStart ?? cycleStartRef.current ?? now) as number
  const elapsed = Math.max(0, now - baseStart)
  const timeText = useMemo(() => formatElapsed(elapsed), [elapsed])

  const effectiveModel = useMemo(() => {
    const live = model && model.length ? model : undefined
    if (live) return live
    if (lastModelRef.current) return lastModelRef.current
    for (let i = events.length - 1; i >= 0; i--) {
      const ev: any = events[i]
      if (ev && ev.type === 'message' && ev.role === 'user' && typeof ev.model === 'string' && ev.model.length) {
        return ev.model
      }
    }
    return ''
  }, [model, events])

  const barColor = useMemo(() => {
    const m = String(effectiveModel || '').toLowerCase()
    if (m.includes('gemini')) return '#8b5cf6'
    if (m.includes('qwen')) return '#f59e0b'
    if (m.includes('claude') || m === '') return '#0891b2'
    return 'var(--accent-color, #8b5cf6)'
  }, [effectiveModel])

  const loaderClass = `streaming-loader${visible ? ' streaming-loader--active' : ''}`
  const textClass = `streaming-loader__text${visible ? ' streaming-loader__text--shimmer' : ''}`

  return (
    <div className={loaderClass} role="status" aria-live="polite" aria-hidden={!visible}>
      <div className="streaming-loader__wave" aria-hidden style={{ color: barColor }}>
        <span className="streaming-loader__bar" />
        <span className="streaming-loader__bar" />
        <span className="streaming-loader__bar" />
        <span className="streaming-loader__bar" />
        <span className="streaming-loader__bar" />
      </div>
      <div className="streaming-loader__info">
        {label && <span className={textClass}>{label}</span>}
        {showTimer && <span className={`${textClass} streaming-loader__timer`}>{timeText}</span>}
      </div>
    </div>
  )
}

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}
