import { useMemo } from 'react'
import { BarChart3, Zap } from 'lucide-react'

interface TokenUsageProps {
  content: string
  metadata?: any
}

export function TokenUsage({ content }: TokenUsageProps) {
  const tokenData = useMemo(() => parseTokenUsage(content), [content])
  
  if (!tokenData) return null
  
  return (
    <div className="token-usage">
      <div className="token-usage-header">
        <div className="token-usage-icon">
          <BarChart3 size={16} />
        </div>
        <span className="token-usage-title">Token Usage</span>
      </div>
      
      <div className="token-usage-content">
        <div className="token-stats">
          <div className="token-stat">
            <span className="token-label">Input:</span>
            <span className="token-value">{tokenData.input?.toLocaleString() || 'N/A'}</span>
          </div>
          <div className="token-stat">
            <span className="token-label">Output:</span>
            <span className="token-value">{tokenData.output?.toLocaleString() || 'N/A'}</span>
          </div>
          {tokenData.total && (
            <div className="token-stat">
              <span className="token-label">Total:</span>
              <span className="token-value">{tokenData.total.toLocaleString()}</span>
            </div>
          )}
        </div>
        
        {tokenData.duration && (
          <div className="token-duration">
            <Zap size={12} />
            <span>Completed in {tokenData.duration}</span>
          </div>
        )}
      </div>
    </div>
  )
}

interface TokenData {
  input?: number
  output?: number
  total?: number
  duration?: string
}

function parseTokenUsage(content: string): TokenData | null {
  const lines = content.split('\n')
  let tokenData: TokenData = {}
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    // Look for token usage patterns
    const tokenMatch = trimmed.match(/tokens used:\s*(\d+)/i)
    if (tokenMatch) {
      const tokens = parseInt(tokenMatch[1])
      if (!tokenData.total) {
        tokenData.total = tokens
      } else {
        tokenData.total += tokens
      }
      continue
    }
    
    // Look for duration patterns
    const durationMatch = trimmed.match(/succeeded in (\d+ms)/i)
    if (durationMatch) {
      tokenData.duration = durationMatch[1]
      continue
    }
    
    // Look for specific input/output patterns
    const inputMatch = trimmed.match(/input[:\s]+(\d+)/i)
    if (inputMatch) {
      tokenData.input = parseInt(inputMatch[1])
      continue
    }
    
    const outputMatch = trimmed.match(/output[:\s]+(\d+)/i)
    if (outputMatch) {
      tokenData.output = parseInt(outputMatch[1])
      continue
    }
  }
  
  // If we have total but no input/output, estimate
  if (tokenData.total && !tokenData.input && !tokenData.output) {
    // Rough estimate: assume 70% input, 30% output
    tokenData.input = Math.round(tokenData.total * 0.7)
    tokenData.output = Math.round(tokenData.total * 0.3)
  }
  
  return tokenData.input || tokenData.output || tokenData.total ? tokenData : null
}
