import { useMemo, type RefObject } from 'react'
import { useSession } from '../state/session'
import { useSettings } from '../state/settings'
import {
  CODEX_MODELS,
  MODE_OPTIONS,
} from '../constants/codex'

const CARD_WIDTH = 72
const BORDER_TOP = `╭${'─'.repeat(CARD_WIDTH)}╮`
const BORDER_BOTTOM = `╰${'─'.repeat(CARD_WIDTH)}╯`

const formatLine = (content: string) => {
  const trimmed = content.length > CARD_WIDTH ? content.slice(0, CARD_WIDTH) : content
  return `│${trimmed.padEnd(CARD_WIDTH, ' ')}│`
}

const formatLabelLine = (label: string, value: string) => {
  const paddedLabel = `${label}:`.padEnd(14, ' ')
  return formatLine(` ${paddedLabel}${value}`)
}

const formatTokens = (value?: number) => {
  if (value == null) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  return value.toString()
}

const bar = (percent?: number) => {
  const width = 23
  const value = Math.min(100, Math.max(0, percent ?? 0))
  const filled = Math.round((value / 100) * width)
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`
}

const formatTime = (seconds?: number) => {
  if (seconds == null) return 'unknown'
  if (seconds === 0) return 'now'
  const target = new Date(Date.now() + seconds * 1000)
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(target)
}

const formatDateSuffix = (seconds?: number) => {
  if (seconds == null) return ''
  const target = new Date(Date.now() + seconds * 1000)
  const today = new Date()
  if (
    target.getFullYear() === today.getFullYear() &&
    target.getMonth() === today.getMonth() &&
    target.getDate() === today.getDate()
  ) {
    return ''
  }

  return ` on ${target.getDate()} ${target.toLocaleString(undefined, { month: 'short' })}`
}

const identifyWindowLabel = (minutes?: number) => {
  switch (minutes) {
    case 300:
      return '5h limit'
    case 10_080:
      return 'Weekly limit'
    case 1_440:
      return 'Daily limit'
    case 60:
      return 'Hourly limit'
    default:
      return 'Limit'
  }
}

const collapsePath = (path?: string) => {
  if (!path) return ''
  const macMatch = path.match(/^(\/Users\/[^/]+)/)
  if (macMatch) {
    return path.replace(macMatch[1], '~')
  }
  const linuxMatch = path.match(/^(\/home\/[^/]+)/)
  if (linuxMatch) {
    return path.replace(linuxMatch[1], '~')
  }
  return path
}

type CodexAgentConfig = { displayMode?: 'clean' | 'compact' | 'verbose' }

const reasoningSummary = (modelEffort?: string, codexSettings?: CodexAgentConfig) => {
  const effortText = modelEffort ? `reasoning ${modelEffort}` : 'reasoning default'
  let summaries = 'summaries auto'
  const displayMode = codexSettings?.displayMode
  if (displayMode === 'compact') summaries = 'summaries compact'
  if (displayMode === 'verbose') summaries = 'summaries verbose'

  return `${effortText}, ${summaries}`
}

export function StatusCard({ onClose, containerRef }: { onClose: () => void; containerRef: RefObject<HTMLDivElement> }) {
  const codexSelection = useSession((s) => s.codexSelection)
  const projectDir = useSession((s) => s.projectDir)
  const sessionId = useSession((s) => s.sessionId)
  const contextUsage = useSession((s) => s.contextUsage)
  const streamingModel = useSession((s) => s.streamingModel)
  const settings = useSettings((s) => s.settings)

  const model = useMemo(
    () => CODEX_MODELS.find((m) => m.id === codexSelection.modelId) ?? CODEX_MODELS[0],
    [codexSelection.modelId],
  )

  const mode = useMemo(
    () => MODE_OPTIONS.find((opt) => opt.id === codexSelection.modeId) ?? MODE_OPTIONS[0],
    [codexSelection.modeId],
  )

  const tokenUsage = useMemo(() => contextUsage?.tokenUsage, [contextUsage?.tokenUsage])

  const primaryLimit = contextUsage?.rateLimits?.primary
  const secondaryLimit = contextUsage?.rateLimits?.secondary

  const accountLine = useMemo(() => {
    if (settings.apiKey) return 'API key configured'
    const codexAgent = settings.agents?.codex
    if (codexAgent?.binPath) return `Binary ${codexAgent.binPath}`
    return streamingModel ? `Streaming ${streamingModel}` : 'Desktop session'
  }, [settings.apiKey, settings.agents?.codex, streamingModel])

  const agentsSummary = useMemo(() => {
    const agents = settings.agents ?? {}
    const enabled = Object.entries(agents).filter(([, cfg]) => Boolean(cfg?.enabled)).map(([name]) => name)
    return enabled.length > 0 ? enabled.join(', ') : '<none>'
  }, [settings.agents])

  const reasoning = reasoningSummary(model.effort, settings.agents?.codex)

  const directory = collapsePath(projectDir) || ''

  const summary = [
    BORDER_TOP,
    formatLine(' >_ OpenAI Codex (v0.42.0)'),
    formatLine(''),
    formatLabelLine('Model', `${model.slug} (${reasoning})`),
    formatLabelLine('Directory', directory),
    formatLabelLine('Approval', mode.approvalPolicy),
    formatLabelLine('Sandbox', mode.sandboxMode),
    formatLabelLine('Agents.md', agentsSummary),
    formatLabelLine('Account', accountLine),
    formatLabelLine('Session', sessionId),
    formatLine(''),
    formatLabelLine(
      'Token usage',
      `${formatTokens(tokenUsage?.total)} total  (${formatTokens(tokenUsage?.input)} input + ${formatTokens(tokenUsage?.output)} output)`,
    ),
    formatLine(''),
  ]

  if (primaryLimit && primaryLimit.usedPercent !== undefined) {
    const label = identifyWindowLabel(primaryLimit.windowMinutes)
    const percent = Math.round(primaryLimit.usedPercent)
    const primaryReset = `${formatTime(primaryLimit.resetsInSeconds)}${formatDateSuffix(primaryLimit.resetsInSeconds)}`
    summary.push(
      formatLabelLine(
        label,
        `${bar(primaryLimit.usedPercent)} ${percent}% used (resets ${primaryReset})`,
      ),
    )
  }

  if (secondaryLimit && secondaryLimit.usedPercent !== undefined) {
    const label = identifyWindowLabel(secondaryLimit.windowMinutes)
    const percent = Math.round(secondaryLimit.usedPercent)
    const secondaryReset = `${formatTime(secondaryLimit.resetsInSeconds)}${formatDateSuffix(secondaryLimit.resetsInSeconds)}`
    summary.push(
      formatLabelLine(
        label,
        `${bar(secondaryLimit.usedPercent)} ${percent}% used (resets ${secondaryReset})`,
      ),
    )
  }

  summary.push(BORDER_BOTTOM)

  return (
    <div className="status-popup" ref={containerRef}>
      <div className="status-popup-card" role="dialog" aria-label="Codex status">
        <div className="status-popup-header">
          <span>/status</span>
          <button type="button" className="status-popup-close" onClick={onClose} aria-label="Close status">
            ×
          </button>
        </div>
        <pre className="status-popup-pre">{summary.join('\n')}</pre>
      </div>
    </div>
  )
}
