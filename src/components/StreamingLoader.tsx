import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../state/session'

interface StreamingLoaderProps {
  label?: string
  showTimer?: boolean
  startTime?: number
  active?: boolean // externally controlled visibility to keep component mounted
}

// Animated wave loader with an elapsed timer
export function StreamingLoader({ label, showTimer = true, startTime, active }: StreamingLoaderProps) {
  const isStreaming = useSession((s) => s.isStreaming)
  const storeStart = useSession((s) => s.streamingStartTime)
  const model = useSession((s) => s.streamingModel)
  const events = useSession((s) => s.events)
  const lastModelRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (model && model.length > 0) lastModelRef.current = model
  }, [model])

  // Keep loader mounted and avoid flicker: hold for a grace period after activity ends
  const [now, setNow] = useState(Date.now())
  const resumeThresholdMs = 2000 // if activity resumes within 2s, keep same start time
  const lastNotVisibleRef = useRef<number>(Date.now())
  // Do NOT set cycleStart at mount; only when becoming visible to avoid timer starting on app open
  const cycleStartRef = useRef<number | undefined>(undefined)
  const prevVisibleRef = useRef<boolean>(false)

  // awaitingFirstOutput removed; visibility now depends on active or finish cooldown

  // Compute visibility: show whenever streaming is active.
  // Timer will use a sensible fallback start time if none is present yet.
  const activeNow = !!(typeof active === 'boolean' ? active : isStreaming)
  const visible = activeNow

  // Manage cycle start so timer doesn't reset on quick resumes
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

  // Tick every 250ms while visible, then stop
  useEffect(() => {
    if (!visible) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [visible])

  // Determine effective start:
  // 1) Explicit startTime
  // 2) Store start (set by setStreaming(true))
  // 3) Cycle start (set when we became visible)
  // 4) Fallback to now to avoid timer starting at app open
  const baseStart = (startTime ?? storeStart ?? cycleStartRef.current ?? now) as number
  const elapsed = Math.max(0, now - baseStart)
  const timeText = useMemo(() => formatElapsed(elapsed), [elapsed])

  // Compute a model-specific bar color; keep surrounding text subtle
  // Resolve effective model: prefer live streamingModel; else last seen; else last user message.model
  const effectiveModel = useMemo(() => {
    const live = model && model.length ? model : undefined
    if (live) return live
    if (lastModelRef.current) return lastModelRef.current
    // Look back for the last user message that carried a model (Composer sets this)
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

  return (
    <div 
      className="streaming-loader"
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '2px 0',
        margin: '6px 0',
        color: 'var(--text-secondary)',
        visibility: visible ? 'visible' : 'hidden',
        height: visible ? undefined : 0
      }}
    >
      <style>{`
        @keyframes wave {
          0% { transform: scaleY(0.4); }
          20% { transform: scaleY(1); }
          40% { transform: scaleY(0.5); }
          60% { transform: scaleY(0.9); }
          80% { transform: scaleY(0.6); }
          100% { transform: scaleY(0.4); }
        }
        .wave {
          display: flex;
          align-items: flex-end;
          gap: 3px;
          height: 14px;
        }
        .bar {
          width: 3px;
          height: 100%;
          background: currentColor;
          border-radius: 2px;
          transform-origin: bottom center;
          animation: wave 1.2s infinite ease-in-out;
          opacity: 0.7;
        }
        .bar:nth-child(1) { animation-delay: 0ms; }
        .bar:nth-child(2) { animation-delay: 120ms; }
        .bar:nth-child(3) { animation-delay: 240ms; }
        .bar:nth-child(4) { animation-delay: 360ms; }
        .bar:nth-child(5) { animation-delay: 480ms; }
      `}</style>

      <div className="wave" aria-hidden style={{ color: barColor }}>
        <div className="bar" />
        <div className="bar" />
        <div className="bar" />
        <div className="bar" />
        <div className="bar" />
      </div>

      {void label}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        {showTimer && (
          <span style={{ color: 'var(--text-secondary)', fontSize: 12, opacity: 0.8 }}>
            {timeText}
          </span>
        )}
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
