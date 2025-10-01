export type ReasoningEffortLevel = 'minimal' | 'low' | 'medium' | 'high'

export type CodexModel = {
  id: string
  label: string
  description: string
  color: string
  slug: string
  effort?: ReasoningEffortLevel
}

export const CODEX_MODELS: CodexModel[] = [
  {
    id: 'gpt-5-codex-low',
    label: 'gpt-5-codex low',
    description: 'Codex automation tuned for low reasoning effort.',
    color: '#6366f1',
    slug: 'gpt-5-codex',
    effort: 'low',
  },
  {
    id: 'gpt-5-codex-medium',
    label: 'gpt-5-codex medium',
    description: 'Balanced Codex automation profile.',
    color: '#7c3aed',
    slug: 'gpt-5-codex',
  },
  {
    id: 'gpt-5-codex-high',
    label: 'gpt-5-codex high',
    description: 'Codex automation with maximum reasoning depth.',
    color: '#a855f7',
    slug: 'gpt-5-codex',
    effort: 'high',
  },
  {
    id: 'gpt-5-minimal',
    label: 'gpt-5 minimal',
    description: 'Fastest responses with limited reasoning; good for lightweight tasks.',
    color: '#0ea5e9',
    slug: 'gpt-5',
    effort: 'minimal',
  },
  {
    id: 'gpt-5-low',
    label: 'gpt-5 low',
    description: 'Balances speed with some reasoning for straightforward prompts.',
    color: '#14b8a6',
    slug: 'gpt-5',
    effort: 'low',
  },
  {
    id: 'gpt-5-medium',
    label: 'gpt-5 medium',
    description: 'Default mix of reasoning depth and latency.',
    color: '#f97316',
    slug: 'gpt-5',
    effort: 'medium',
  },
  {
    id: 'gpt-5-high',
    label: 'gpt-5 high',
    description: 'Maximum reasoning depth for complex or ambiguous problems.',
    color: '#ef4444',
    slug: 'gpt-5',
    effort: 'high',
  },
]

export const DEFAULT_MODEL_ID = 'gpt-5-medium'

export type ApprovalPolicyValue = 'untrusted' | 'on-request' | 'on-failure' | 'never'
export type SandboxModeValue = 'workspace-write' | 'danger-full-access' | 'read-only'
export type ModeOptionId = 'chat-plan' | 'agent' | 'agent-full'

export type ModeOption = {
  id: ModeOptionId
  label: string
  autoAccept: boolean
  approvalPolicy: ApprovalPolicyValue
  sandboxMode: SandboxModeValue
}

export const MODE_OPTIONS: ModeOption[] = [
  {
    id: 'chat-plan',
    label: 'Chat or Plan',
    autoAccept: false,
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
  },
  {
    id: 'agent',
    label: 'Agent',
    autoAccept: false,
    approvalPolicy: 'on-failure',
    sandboxMode: 'workspace-write',
  },
  {
    id: 'agent-full',
    label: 'Agent (full access)',
    autoAccept: true,
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
  },
]

export const DEFAULT_MODE_ID: ModeOptionId = 'agent-full'
