interface LightningLoaderProps {
  showText?: boolean
  text?: string
}

export function LightningLoader({ showText = false, text = "Claude is thinking" }: LightningLoaderProps = {}) {
  return (
    <div className="dots-loader" style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '12px 20px',
      marginTop: '8px',
      marginBottom: '8px'
    }}>
      <style>{`
        @keyframes blink {
          0%, 60% { opacity: 0.2; }
          20% { opacity: 1; }
        }
        .dot-1 { animation: blink 1.4s infinite 0s; }
        .dot-2 { animation: blink 1.4s infinite 0.2s; }
        .dot-3 { animation: blink 1.4s infinite 0.4s; }
        
        .dots-container {
          display: flex;
          gap: 4px;
          font-size: 28px;
          color: #9ca3af;
        }
      `}</style>
      
      <div className="dots-container">
        <span className="dot-1">•</span>
        <span className="dot-2">•</span>
        <span className="dot-3">•</span>
      </div>
      
      {showText && (
        <span style={{ 
          fontSize: '14px', 
          color: '#6b7280',
          fontStyle: 'italic'
        }}>
          {text}
        </span>
      )}
    </div>
  )
}