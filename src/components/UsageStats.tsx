import { useState, useEffect } from 'react'
import { ModelRouter } from '../utils/modelRouter'
import { TrendingUp, DollarSign, Zap, Sparkles, Bot } from 'lucide-react'

export function UsageStats() {
  const [stats, setStats] = useState<any>(null)
  const [router] = useState(() => new ModelRouter())
  
  useEffect(() => {
    // Update stats every second
    const interval = setInterval(() => {
      setStats(router.getUsageStats())
    }, 1000)
    
    // Initial load
    setStats(router.getUsageStats())
    
    return () => clearInterval(interval)
  }, [router])
  
  if (!stats) return null
  
  const formatPercentage = (pct: number) => {
    if (pct === 0) return '0%'
    if (pct === Infinity || isNaN(pct)) return '-'
    return `${Math.round(pct)}%`
  }
  
  return (
    <div className="usage-stats">
      <div className="usage-header">
        <h3>Model Usage Today</h3>
        <div className="savings-badge">
          <DollarSign size={14} />
          <span>Saved ${stats.estimatedSavingsUSD.toFixed(2)}</span>
        </div>
      </div>
      
      <div className="usage-grid">
        <div className="usage-card">
          <div className="usage-icon qwen">
            <Zap size={16} />
          </div>
          <div className="usage-info">
            <div className="usage-name">Qwen</div>
            <div className="usage-quota">
              {stats.qwen.used} / {stats.qwen.total} requests
            </div>
            <div className="usage-bar">
              <div 
                className="usage-fill qwen"
                style={{ width: `${Math.min(stats.qwen.percentage, 100)}%` }}
              />
            </div>
            <div className="usage-remaining">
              {stats.qwen.remaining} remaining (Free)
            </div>
          </div>
        </div>
        
        <div className="usage-card">
          <div className="usage-icon gemini">
            <Sparkles size={16} />
          </div>
          <div className="usage-info">
            <div className="usage-name">Gemini</div>
            <div className="usage-quota">
              {stats.gemini.used} / {stats.gemini.total} requests
            </div>
            <div className="usage-bar">
              <div 
                className="usage-fill gemini"
                style={{ width: `${Math.min(stats.gemini.percentage, 100)}%` }}
              />
            </div>
            <div className="usage-remaining">
              {stats.gemini.remaining} remaining (Free)
            </div>
          </div>
        </div>
        
        <div className="usage-card">
          <div className="usage-icon claude">
            <Bot size={16} />
          </div>
          <div className="usage-info">
            <div className="usage-name">Claude</div>
            <div className="usage-quota">
              {stats.claude.used} requests (Paid)
            </div>
            <div className="usage-bar disabled">
              <div className="usage-fill claude" style={{ width: '0%' }} />
            </div>
            <div className="usage-remaining">
              Unlimited (costs apply)
            </div>
          </div>
        </div>
      </div>
      
      <div className="usage-summary">
        <div className="summary-item">
          <TrendingUp size={14} />
          <span>Free tier utilization: {formatPercentage((stats.totalFreeUsed / stats.totalFreeAvailable) * 100)}</span>
        </div>
        <div className="summary-item">
          <span className="text-muted">
            {stats.totalFreeAvailable - stats.totalFreeUsed} free requests remaining today
          </span>
        </div>
      </div>
    </div>
  )
}