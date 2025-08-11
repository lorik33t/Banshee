import { useState } from 'react'

import type { ReactNode } from 'react'
type Tab = { key: string; label: string; content: ReactNode }

export function Tabs({ tabs, initial = tabs[0]?.key }: { tabs: Tab[]; initial?: string }) {
  const [active, setActive] = useState(initial)
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            className={"chip"}
            onClick={() => setActive(t.key)}
            style={{
              borderColor: active === t.key ? 'var(--accent)' : 'var(--border)',
              color: active === t.key ? 'var(--text)' : 'var(--muted)'
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>
        {tabs.find((t) => t.key === active)?.content}
      </div>
    </div>
  )
}
