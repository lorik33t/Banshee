import { useEffect } from 'react'
import { BarChart3, X } from 'lucide-react'
import { ModelRouter } from '../utils/modelRouter'

interface UsageStatsModalProps {
  open: boolean
  onClose: () => void
  router: ModelRouter
}

export function UsageStatsModal({ open, onClose, router }: UsageStatsModalProps) {
  if (!open) return null

  // Close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  let stats: any
  let reason: string | null = null
  let statsError: string | null = null
  try {
    stats = router.getUsageStats()
    reason = router.getLastReason()
  } catch (e: any) {
    statsError = e?.message || 'Failed to load usage stats'
    // Surface error for diagnosis instead of silently failing
    try { console.error('[UsageStatsModal] getUsageStats failed:', e) } catch {}
  }
  if (!stats && !statsError) {
    statsError = 'No usage stats available'
  }

  const reservePct = 15
  const reserveGemini = Math.floor(((stats?.gemini?.total ?? 0) * reservePct) / 100)
  const reserveQwen = Math.floor(((stats?.qwen?.total ?? 0) * reservePct) / 100)
  const reserveCodex = Math.floor(((stats?.codex?.total ?? 0) * reservePct) / 100)

  const Row = ({ name, color, used, total, reserve }: { name: string; color: string; used: number; total: number; reserve: number }) => {
    const pct = Math.min(100, Math.round((used / total) * 100))
    const reserveStartPct = Math.max(0, 100 - Math.round((reserve / total) * 100))
    return (
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, background: color, borderRadius: 2 }} /> {name}
          </span>
          <span style={{ opacity: 0.8 }}>{used} / {total} • {Math.max(0, 100 - pct)}% left</span>
        </div>
        <div style={{ position: 'relative', height: 10, borderRadius: 5, background: 'var(--bg-tertiary)', overflow: 'hidden', marginTop: 6 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: color, opacity: 0.9 }} />
          <div style={{ position: 'absolute', left: `${reserveStartPct}%`, top: 0, bottom: 0, right: 0, background: 'repeating-linear-gradient(45deg, rgba(0,0,0,0.08), rgba(0,0,0,0.08) 6px, rgba(255,255,255,0.06) 6px, rgba(255,255,255,0.06) 12px)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.8, marginTop: 4 }}>
          <span>Reserve ~{reserve}</span>
          <span>Remaining {Math.max(0, total - used)}</span>
        </div>
      </div>
    )
  }

  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: '92vw', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.25)', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            <BarChart3 size={18} /> Usage stats
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'var(--fg-secondary)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {statsError ? (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--fg-secondary)' }}>
            Failed to load usage stats. Please try again.
          </div>
        ) : (
          <>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
              Free used: {stats?.totalFreeUsed ?? 0}/{stats?.totalFreeAvailable ?? 0} • Saved ~${(stats?.estimatedSavingsUSD ?? 0).toFixed ? stats.estimatedSavingsUSD.toFixed(2) : (0).toFixed(2)}
            </div>

            <div style={{ marginTop: 12 }}>
              <Row name="Gemini" color="#8b5cf6" used={stats?.gemini?.used ?? 0} total={stats?.gemini?.total ?? 0} reserve={reserveGemini} />
              <Row name="Qwen" color="#f59e0b" used={stats?.qwen?.used ?? 0} total={stats?.qwen?.total ?? 0} reserve={reserveQwen} />
              <Row name="Codex" color="#10b981" used={stats?.codex?.used ?? 0} total={stats?.codex?.total ?? 0} reserve={reserveCodex} />
            </div>

            <div style={{ marginTop: 14, fontSize: 12, opacity: 0.85 }} title={reason || undefined}>
              Last route: {reason || 'No prior routing yet'}
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} className="settings-btn primary" style={{ height: 32 }}>Close</button>
        </div>
      </div>
    </div>
  )
}
