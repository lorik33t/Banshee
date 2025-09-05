// Simplified model router that only handles the Codex model

export type ModelType = 'codex'

interface ModelQuota {
  daily: number
  used: number
  resetTime: number
}

interface ModelCapabilities {
  codeGeneration: number // 0-10 rating
  reasoning: number // 0-10 rating
  speed: number // 0-10 rating
  contextWindow: number // tokens
}

export class ModelRouter {
  private quotas: Record<ModelType, ModelQuota>
  private capabilities: Record<ModelType, ModelCapabilities>
  private enabled: boolean
  private auth: boolean
  private lastReason: string | null = null

  constructor() {
    const savedQuotaRaw = localStorage.getItem('codexQuota')
    const tomorrow = new Date()
    tomorrow.setHours(24, 0, 0, 0)
    const resetTime = tomorrow.getTime()

    const defaultQuota = { daily: 1500, used: 0, resetTime }
    let parsed: any = null
    try {
      parsed = savedQuotaRaw ? JSON.parse(savedQuotaRaw) : null
    } catch {
      parsed = null
    }
    const quota = parsed && typeof parsed.daily === 'number' && typeof parsed.used === 'number' && typeof parsed.resetTime === 'number'
      ? parsed
      : defaultQuota
    this.quotas = { codex: quota }
    try { localStorage.setItem('codexQuota', JSON.stringify(this.quotas.codex)) } catch {}

    this.resetQuotasIfNeeded()

    this.capabilities = {
      codex: {
        codeGeneration: 9,
        reasoning: 7,
        speed: 9,
        contextWindow: 200000
      }
    }

    this.enabled = this.loadEnabledFlags()
    this.auth = this.loadAuthFlags()
  }

  private resetQuotasIfNeeded() {
    const now = Date.now()
    const quota = this.quotas.codex
    if (now > quota.resetTime) {
      quota.used = 0
      const tomorrow = new Date()
      tomorrow.setHours(24, 0, 0, 0)
      quota.resetTime = tomorrow.getTime()
      this.saveQuota()
    }
  }

  private saveQuota() {
    localStorage.setItem('codexQuota', JSON.stringify(this.quotas.codex))
  }

  private loadEnabledFlags() {
    try {
      const stored = localStorage.getItem('claude_settings')
      if (stored) {
        const settings = JSON.parse(stored)
        return !!settings?.agents?.codex?.enabled
      }
    } catch (e) {
      try { console.warn('[ModelRouter] failed to read enabled flag:', e) } catch {}
    }
    return false
  }

  private loadAuthFlags() {
    try {
      const stored = localStorage.getItem('modelAuthStatus')
      if (stored) {
        const parsed = JSON.parse(stored)
        return !!parsed.codex
      }
    } catch {}
    return false
  }

  private refreshFlags() {
    this.enabled = this.loadEnabledFlags()
    this.auth = this.loadAuthFlags()
  }

  selectModel(prompt: string, preferredModel?: ModelType): ModelType {
    return this.selectModelWithReason(prompt, preferredModel).model
  }

  selectModelWithReason(prompt: string, preferredModel?: ModelType): { model: ModelType; reason: string } {
    this.refreshFlags()
    this.resetQuotasIfNeeded()

    if (preferredModel === 'codex') {
      this.lastReason = 'User-forced @codex'
      return { model: 'codex', reason: this.lastReason }
    }

    if (!this.enabled) {
      this.lastReason = 'Codex disabled in settings'
      return { model: 'codex', reason: this.lastReason }
    }

    if (!this.auth) {
      this.lastReason = 'Codex not authenticated'
      return { model: 'codex', reason: this.lastReason }
    }

    if (this.quotas.codex.used >= this.quotas.codex.daily) {
      this.lastReason = 'Codex quota exceeded'
      return { model: 'codex', reason: this.lastReason }
    }

    this.lastReason = 'Codex selected'
    return { model: 'codex', reason: this.lastReason }
  }

  recordUsage(model: ModelType) {
    const quota = this.quotas[model]
    quota.used++
    this.saveQuota()
  }

  getLastReason() {
    return this.lastReason
  }

  getUsageStats() {
    this.resetQuotasIfNeeded()
    const q = this.quotas.codex
    return {
      codex: {
        used: q.used,
        remaining: q.daily - q.used,
        total: q.daily,
        percentage: (q.used / q.daily) * 100
      }
    }
  }

  getModelInfo(model: ModelType) {
    return {
      name: 'Codex',
      capabilities: this.capabilities[model],
      quota: this.quotas[model],
      isFree: true
    }
  }
}

