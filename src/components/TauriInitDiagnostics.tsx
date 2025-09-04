import { useEffect, useState } from 'react'

interface InitEvent {
  timestamp: number
  event: string
  details?: any
}

export function TauriInitDiagnostics() {
  const [events, setEvents] = useState<InitEvent[]>([])
  const [isVisible, setIsVisible] = useState(false)
  
  useEffect(() => {
    const startTime = performance.now()
    
    const addEvent = (event: string, details?: any) => {
      setEvents(prev => [...prev, {
        timestamp: performance.now() - startTime,
        event,
        details
      }])
    }
    
    // Check initial state
    addEvent('Component mounted', {
      tauriAvailable: !!(window as any).__TAURI__,
      windowLocation: window.location.href
    })
    
    // Monitor Tauri availability
    let checkCount = 0
    const checkInterval = setInterval(() => {
      checkCount++
      const available = !!(window as any).__TAURI__
      
      if (available && checkCount === 1) {
        addEvent('Tauri became available immediately')
        clearInterval(checkInterval)
      } else if (available) {
        addEvent(`Tauri became available after ${checkCount} checks`)
        clearInterval(checkInterval)
      } else if (checkCount > 50) {
        addEvent('Tauri not available after 50 checks (5 seconds)')
        clearInterval(checkInterval)
      }
    }, 100)
    
    // Check for fs plugin
    import('@tauri-apps/plugin-fs').then(module => {
      addEvent('FS plugin module loaded', {
        hasReadDir: !!module.readDir,
        hasExists: !!module.exists,
        hasBaseDirectory: !!module.BaseDirectory
      })
    }).catch(err => {
      addEvent('FS plugin module failed to load', { error: String(err) })
    })
    
    return () => {
      clearInterval(checkInterval)
    }
  }, [])
  
  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        style={{
          position: 'fixed',
          bottom: '10px',
          right: '10px',
          padding: '5px 10px',
          fontSize: '11px',
          backgroundColor: 'var(--bg-tertiary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '4px',
          cursor: 'pointer',
          zIndex: 9999
        }}
      >
        Show Init Diagnostics
      </button>
    )
  }
  
  return (
    <div style={{
      position: 'fixed',
      bottom: '10px',
      right: '10px',
      width: '400px',
      maxHeight: '300px',
      backgroundColor: 'var(--bg-primary)',
      border: '1px solid var(--border-primary)',
      borderRadius: '4px',
      padding: '10px',
      fontSize: '11px',
      fontFamily: 'monospace',
      overflowY: 'auto',
      zIndex: 9999
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
        <strong>Tauri Initialization Timeline</strong>
        <button
          onClick={() => setIsVisible(false)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          ×
        </button>
      </div>
      {events.map((event, i) => (
        <div key={i} style={{ marginBottom: '5px' }}>
          <span style={{ color: '#888' }}>{event.timestamp.toFixed(0)}ms</span>
          {' '}
          <span style={{ color: event.event.includes('available') ? '#51cf66' : 'inherit' }}>
            {event.event}
          </span>
          {event.details && (
            <div style={{ marginLeft: '50px', color: '#666', fontSize: '10px' }}>
              {JSON.stringify(event.details, null, 2)}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}