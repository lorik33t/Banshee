// Model router with intelligent task distribution and cost optimization

export type ModelType = 'claude' | 'gemini' | 'qwen' | 'codex'

interface ModelQuota {
  daily: number
  used: number
  resetTime: number
}

interface ModelCapabilities {
  codeGeneration: number  // 0-10 rating
  reasoning: number       // 0-10 rating
  speed: number          // 0-10 rating
  contextWindow: number  // tokens
}

export class ModelRouter {
  private quotas: Record<ModelType, ModelQuota>
  private capabilities: Record<ModelType, ModelCapabilities>
  private enabled: { gemini: boolean; qwen: boolean; codex: boolean }
  private auth: { gemini: boolean; qwen: boolean; codex: boolean }
  private reserveRatio: { gemini: number; qwen: number; codex: number }
  private lastReason: string | null = null
  
  constructor() {
    // Initialize quotas from localStorage or defaults
    const savedQuotasRaw = localStorage.getItem('modelQuotas')
    const tomorrow = new Date()
    tomorrow.setHours(24, 0, 0, 0)
    const resetTime = tomorrow.getTime()
    
    // Load and migrate quotas safely to ensure all models exist
    const defaults = {
      qwen: { daily: 2000, used: 0, resetTime },
      gemini: { daily: 1000, used: 0, resetTime },
      codex: { daily: 1500, used: 0, resetTime },
      claude: { daily: Infinity as number, used: 0, resetTime }
    } as any
    let parsed: any = null
    try {
      parsed = savedQuotasRaw ? JSON.parse(savedQuotasRaw) : null
    } catch {
      parsed = null
    }
    const merged: any = { ...defaults, ...(parsed || {}) }
    // Ensure each model has required fields and sane numbers
    ;(['qwen','gemini','codex','claude'] as const).forEach((m) => {
      const d = (defaults as any)[m]
      const q = merged[m] || {}
      const daily = Number.isFinite(q.daily) || q.daily === Infinity ? q.daily : d.daily
      const used = Number.isFinite(q.used) ? q.used : d.used
      const rt = typeof q.resetTime === 'number' && q.resetTime > 0 ? q.resetTime : d.resetTime
      merged[m] = { daily, used, resetTime: rt }
    })
    this.quotas = merged
    // Persist migrated structure
    try { localStorage.setItem('modelQuotas', JSON.stringify(this.quotas)) } catch {}
    
    // Reset quotas if new day
    this.resetQuotasIfNeeded()
    
    // Model capabilities for intelligent routing
    this.capabilities = {
      qwen: {
        codeGeneration: 9,
        reasoning: 7,
        speed: 9,
        contextWindow: 32000
      },
      gemini: {
        codeGeneration: 7,
        reasoning: 8,
        speed: 8,
        contextWindow: 1000000
      },
      claude: {
        codeGeneration: 10,
        reasoning: 10,
        speed: 7,
        contextWindow: 200000
      },
      codex: {
        codeGeneration: 9,
        reasoning: 7,
        speed: 9,
        contextWindow: 200000
      }
    }

    // Initialize flags
    this.enabled = this.loadEnabledFlags()
    this.auth = this.loadAuthFlags()

    // Keep a small reserve to avoid exhausting free tiers early
    this.reserveRatio = {
      gemini: 0.15, // 15% reserve
      qwen: 0.15,
      codex: 0.15,
    }
  }
  
  private resetQuotasIfNeeded() {
    const now = Date.now()
    Object.keys(this.quotas).forEach((model) => {
      const quota = this.quotas[model as ModelType]
      if (now > quota.resetTime) {
        quota.used = 0
        const tomorrow = new Date()
        tomorrow.setHours(24, 0, 0, 0)
        quota.resetTime = tomorrow.getTime()
      }
    })
    this.saveQuotas()
  }
  
  private saveQuotas() {
    localStorage.setItem('modelQuotas', JSON.stringify(this.quotas))
  }

  private loadEnabledFlags() {
    try {
      const stored = localStorage.getItem('claude_settings')
      if (stored) {
        const settings = JSON.parse(stored)
        let geminiEnabled = false
        let qwenEnabled = false
        let codexEnabled = false

        // Handle subAgents as an array (legacy shape)
        if (Array.isArray(settings?.subAgents)) {
          const geminiAgent = settings.subAgents.find((a: any) => a?.name === 'gemini-context')
          const qwenAgent = settings.subAgents.find((a: any) => a?.name === 'qwen-automation')
          if (geminiAgent) geminiEnabled = !!geminiAgent.enabled
          if (qwenAgent) qwenEnabled = !!qwenAgent.enabled
        }

        // Handle agents as an object (current shape from settings.ts)
        if (settings?.agents && typeof settings.agents === 'object') {
          if (settings.agents.gemini) geminiEnabled = geminiEnabled || !!settings.agents.gemini.enabled
          if (settings.agents.qwen) qwenEnabled = qwenEnabled || !!settings.agents.qwen.enabled
          if (settings.agents.codex) codexEnabled = !!settings.agents.codex.enabled
        }

        return { gemini: geminiEnabled, qwen: qwenEnabled, codex: codexEnabled }
      }
    } catch (e) {
      try { console.warn('[ModelRouter] failed to read enabled flags:', e) } catch {}
    }
    return { gemini: false, qwen: false, codex: false }
  }

  private loadAuthFlags() {
    try {
      const stored = localStorage.getItem('modelAuthStatus')
      if (stored) {
        const parsed = JSON.parse(stored)
        return { gemini: !!parsed.gemini, qwen: !!parsed.qwen, codex: !!parsed.codex }
      }
    } catch {}
    return { gemini: false, qwen: false, codex: false }
  }

  private refreshFlags() {
    // Lightweight reads; safe to call before each selection
    this.enabled = this.loadEnabledFlags()
    this.auth = this.loadAuthFlags()
  }
  
  private analyzePrompt(prompt: string) {
    const analysis = {
      isCode: false,
      isComplex: false,
      isRefactor: false,
      isDebug: false,
      isSimpleQuery: false,
      estimatedTokens: Math.ceil(prompt.length / 4)
    }
    
    // Code-related patterns
    const codePatterns = /\b(fix|debug|implement|refactor|write|code|function|class|bug|error|compile)\b/i
    const complexPatterns = /\b(architecture|design|analyze|explain|review|optimize|performance)\b/i
    const refactorPatterns = /\b(refactor|restructure|reorganize|improve|clean)\b/i
    const debugPatterns = /\b(debug|error|bug|crash|issue|problem|failing|broken)\b/i
    const simplePatterns = /\b(what|how|list|show|display|get)\b/i
    
    analysis.isCode = codePatterns.test(prompt)
    analysis.isComplex = complexPatterns.test(prompt) || prompt.length > 500
    analysis.isRefactor = refactorPatterns.test(prompt)
    analysis.isDebug = debugPatterns.test(prompt)
    analysis.isSimpleQuery = simplePatterns.test(prompt) && prompt.length < 100
    
    return analysis
  }
  
  private withinReserve(model: Exclude<ModelType, 'claude'>) {
    const q = this.quotas[model]
    const reserve = Math.floor(q.daily * this.reserveRatio[model])
    return q.used >= (q.daily - reserve)
  }
  
  private moreConsumed(a: Exclude<ModelType, 'claude'>, b: Exclude<ModelType, 'claude'>) {
    const qa = this.quotas[a]
    const qb = this.quotas[b]
    const pa = qa.used / qa.daily
    const pb = qb.used / qb.daily
    return pa > pb + 0.05 // 5% margin
  }
  
  selectModel(prompt: string, preferredModel?: ModelType): ModelType {
    // Back-compat wrapper using the new API
    return this.selectModelWithReason(prompt, preferredModel).model
  }

  selectModelWithReason(prompt: string, preferredModel?: ModelType): { model: ModelType; reason: string } {
    // Refresh runtime flags
    this.refreshFlags()
    // Reset quotas if needed
    this.resetQuotasIfNeeded()
    const dev = (import.meta as any)?.env?.DEV
    if (dev) {
      try {
        console.debug('[ModelRouter] start selection', {
          preferredModel,
          enabled: this.enabled,
          auth: this.auth,
          quotas: {
            qwen: this.quotas.qwen,
            gemini: this.quotas.gemini,
            codex: this.quotas.codex
          }
        })
      } catch {}
    }
    
    // If user specified a model, try to use it if quota available AND allowed
    if (preferredModel) {
      const quota = this.quotas[preferredModel]
      const allowed =
        preferredModel === 'claude' ||
        (preferredModel === 'gemini' && this.enabled.gemini && this.auth.gemini) ||
        (preferredModel === 'qwen' && this.enabled.qwen && this.auth.qwen) ||
        (preferredModel === 'codex' && this.enabled.codex && this.auth.codex)
      if (allowed && quota.used < quota.daily) {
        const reason = `User-forced @${preferredModel}`
        this.lastReason = reason
        if (dev) { try { console.debug('[ModelRouter] honoring preferred model', { preferredModel, reason }) } catch {} }
        return { model: preferredModel, reason }
      }
      if (dev) { try { console.debug('[ModelRouter] preferred model rejected', { preferredModel, allowed, used: quota.used, daily: quota.daily }) } catch {} }
    }
    
    const analysis = this.analyzePrompt(prompt)
    
    // Decision tree based on task type, balanced usage, and reserves
    
    // Helper lambdas
    const canUse = (m: Exclude<ModelType, 'claude'>) => this.enabled[m] && this.auth[m] && this.quotas[m].used < this.quotas[m].daily
    const preferQwen = () => canUse('qwen') && !this.withinReserve('qwen')
    const preferGemini = () => canUse('gemini') && !this.withinReserve('gemini')
    const preferCodex = () => canUse('codex') && !this.withinReserve('codex')

    // For code generation/refactoring, prefer Codex (CLI) for pure code tasks when available
    if (analysis.isCode || analysis.isRefactor) {
      if (preferCodex()) {
        this.lastReason = 'Codex chosen: code task and quota ok'
        return { model: 'codex', reason: this.lastReason }
      }
      if (canUse('qwen')) {
        // If Qwen is notably more consumed than Gemini, try Gemini first
        if (canUse('gemini') && this.moreConsumed('qwen', 'gemini')) {
          this.lastReason = 'Gemini chosen: balancing free quota (Qwen more consumed)'
          return { model: 'gemini', reason: this.lastReason }
        }
        // Respect reserve if near cap
        if (!this.withinReserve('qwen')) {
          this.lastReason = 'Qwen chosen: code task and quota ok'
          return { model: 'qwen', reason: this.lastReason }
        }
      }
    }
    
    // For simple queries, use Gemini (good general purpose, large context)
    if (
      analysis.isSimpleQuery &&
      canUse('gemini')
    ) {
      // If Gemini is more consumed than Qwen, balance to Qwen where appropriate
      if (canUse('qwen') && this.moreConsumed('gemini', 'qwen')) {
        this.lastReason = 'Qwen chosen: balancing free quota (Gemini more consumed)'
        return { model: 'qwen', reason: this.lastReason }
      }
      if (!this.withinReserve('gemini')) {
        this.lastReason = 'Gemini chosen: simple query and quota ok'
        return { model: 'gemini', reason: this.lastReason }
      }
    }
    
    // For debugging, prefer Qwen first (good at code), then Gemini
    if (analysis.isDebug) {
      if (preferQwen()) { this.lastReason = 'Qwen chosen: debug task'; return { model: 'qwen', reason: this.lastReason } }
      if (preferGemini()) { this.lastReason = 'Gemini chosen: debug fallback'; return { model: 'gemini', reason: this.lastReason } }
    }
    
    // For complex analysis, try Gemini first (large context window)
    if (
      analysis.isComplex &&
      canUse('gemini')
    ) {
      if (!this.withinReserve('gemini')) { this.lastReason = 'Gemini chosen: complex analysis and quota ok'; return { model: 'gemini', reason: this.lastReason } }
    }
    
    // Default fallback order: Codex -> Qwen -> Gemini -> Claude
    if (preferCodex()) { this.lastReason = 'Codex chosen: default'; return { model: 'codex', reason: this.lastReason } }
    if (canUse('qwen') && !this.withinReserve('qwen')) { this.lastReason = 'Qwen chosen: default'; return { model: 'qwen', reason: this.lastReason } }
    if (canUse('gemini') && !this.withinReserve('gemini')) { this.lastReason = 'Gemini chosen: default'; return { model: 'gemini', reason: this.lastReason } }
    
    // All free quotas exhausted, use Claude (paid)
    this.lastReason = 'Claude chosen: free quotas exhausted or disabled'
    if (dev) { try { console.debug('[ModelRouter] final decision', { model: 'claude', reason: this.lastReason }) } catch {} }
    return { model: 'claude', reason: this.lastReason }
  }
  
  recordUsage(model: ModelType) {
    const quota = this.quotas[model]
    quota.used++
    this.saveQuotas()
  }

  getLastReason() {
    return this.lastReason
  }
  
  getUsageStats() {
    this.resetQuotasIfNeeded()
    
    const stats = {
      qwen: {
        used: this.quotas.qwen.used,
        remaining: this.quotas.qwen.daily - this.quotas.qwen.used,
        total: this.quotas.qwen.daily,
        percentage: (this.quotas.qwen.used / this.quotas.qwen.daily) * 100
      },
      gemini: {
        used: this.quotas.gemini.used,
        remaining: this.quotas.gemini.daily - this.quotas.gemini.used,
        total: this.quotas.gemini.daily,
        percentage: (this.quotas.gemini.used / this.quotas.gemini.daily) * 100
      },
      codex: {
        used: this.quotas.codex.used,
        remaining: this.quotas.codex.daily - this.quotas.codex.used,
        total: this.quotas.codex.daily,
        percentage: (this.quotas.codex.used / this.quotas.codex.daily) * 100
      },
      claude: {
        used: this.quotas.claude.used,
        remaining: Infinity,
        total: Infinity,
        percentage: 0
      },
      totalFreeUsed: this.quotas.qwen.used + this.quotas.gemini.used + this.quotas.codex.used,
      totalFreeAvailable: this.quotas.qwen.daily + this.quotas.gemini.daily + this.quotas.codex.daily,
      estimatedSavingsUSD: (this.quotas.qwen.used + this.quotas.gemini.used + this.quotas.codex.used) * 0.01 // ~$0.01 per request saved
    }
    
    return stats
  }
  
  getModelInfo(model: ModelType) {
    return {
      name: model.charAt(0).toUpperCase() + model.slice(1),
      capabilities: this.capabilities[model],
      quota: this.quotas[model],
      isFree: model !== 'claude'
    }
  }
}