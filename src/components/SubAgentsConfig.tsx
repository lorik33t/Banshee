import { Plus, Edit3, Trash2, Brain, Code, Search, Check, X, Globe, Cpu, Zap, ToggleLeft, ToggleRight } from 'lucide-react'
import { useState, useEffect } from 'react'

interface SubAgent {
  name: string
  description: string
  tools?: string[]
  model?: string
  systemPrompt: string
  enabled?: boolean
  isModelAgent?: boolean
}

interface SubAgentsConfigProps {
  agents: SubAgent[]
  onChange: (agents: SubAgent[]) => void
}

// Model Agents - These are the main external models that can be enabled
const MODEL_AGENTS: SubAgent[] = [
  {
    name: 'gemini-context',
    description: 'Google Gemini with 1M token context for massive codebase analysis',
    tools: ['Bash', 'Read', 'Grep', 'Glob'],
    systemPrompt: `You are a Gemini-powered subagent specialized in handling massive context windows up to 1 million tokens. 

Your strengths:
- Analyzing entire repositories in a single context
- Understanding complex cross-file dependencies 
- Processing large documentation sets
- Identifying patterns across massive codebases

Use the Bash tool to execute 'gemini' CLI commands when needed.`,
    enabled: false,
    isModelAgent: true
  },
  {
    name: 'qwen-automation',
    description: 'Alibaba Qwen for repository-scale automation and bulk refactoring',
    tools: ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Grep', 'Glob'],
    systemPrompt: `You are a Qwen-powered subagent optimized for repository-scale operations and workflow automation.

Your strengths:
- Bulk refactoring across entire repositories
- Automated PR workflows and code generation
- Large-scale code transformations
- Systematic pattern application

Use the Bash tool to execute 'qwen' CLI commands when needed.`,
    enabled: false,
    isModelAgent: true
  },
  {
    name: 'codex-executor',
    description: 'OpenAI Codex for ultra-fast code execution and quick fixes',
    tools: ['Bash', 'Read', 'Write', 'Edit'],
    systemPrompt: `You are a Codex-powered subagent optimized for fast, efficient code execution using OpenAI's Codex mini model.

Your strengths:
- Rapid code generation and boilerplate creation
- Quick syntax fixes and simple refactoring
- Fast test generation
- Immediate error corrections

Use the Bash tool to execute 'codex' CLI commands when needed.`,
    enabled: false,
    isModelAgent: true
  }
]

// Built-in Claude agents for common tasks
const CLAUDE_AGENTS: SubAgent[] = [
  {
    name: 'code-reviewer',
    description: 'Expert code review for quality, security, and best practices',
    tools: ['Read', 'Grep', 'Glob'],
    systemPrompt: `You are an expert code reviewer. Your role is to:
- Review code for bugs, security issues, and performance problems
- Suggest improvements for readability and maintainability
- Check for adherence to best practices and coding standards
- Identify potential edge cases and error conditions`,
    enabled: true
  },
  {
    name: 'debugger',
    description: 'Debugging specialist for errors and test failures',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    systemPrompt: `You are a debugging specialist. Your role is to:
- Analyze error messages and stack traces
- Identify root causes of bugs
- Suggest fixes and workarounds
- Help with test failures and unexpected behavior`,
    enabled: true
  }
]

export function SubAgentsConfig({ agents, onChange }: SubAgentsConfigProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingAgent, setEditingAgent] = useState<SubAgent | null>(null)
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set())

  // Initialize with model agents if not already present
  useEffect(() => {
    const hasModelAgents = agents.some(a => a.isModelAgent)
    if (!hasModelAgents) {
      // Add model agents at the beginning
      onChange([...MODEL_AGENTS, ...CLAUDE_AGENTS, ...agents])
    }
  }, [])

  const AVAILABLE_TOOLS = [
    'Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 
    'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch',
    'TodoWrite', 'Task'
  ]

  const toggleModelAgent = (index: number) => {
    const newAgents = [...agents]
    newAgents[index] = { ...agents[index], enabled: !agents[index].enabled }
    onChange(newAgents)
  }

  const addCustomAgent = () => {
    const newAgent: SubAgent = {
      name: `custom-agent-${agents.filter(a => !a.isModelAgent).length + 1}`,
      description: 'Custom agent for specialized tasks',
      tools: [],
      systemPrompt: '',
      enabled: true
    }
    setEditingAgent(newAgent)
    setEditingIndex(-1)
    setSelectedTools(new Set())
  }

  const saveAgent = () => {
    if (editingAgent && editingAgent.name && editingAgent.description && editingIndex !== null) {
      const agentToSave = {
        ...editingAgent,
        tools: Array.from(selectedTools)
      }
      
      if (editingIndex === -1) {
        onChange([...agents, agentToSave])
      } else {
        const newAgents = [...agents]
        newAgents[editingIndex] = agentToSave
        onChange(newAgents)
      }
      
      setEditingAgent(null)
      setEditingIndex(null)
      setSelectedTools(new Set())
    }
  }

  const cancelEdit = () => {
    setEditingAgent(null)
    setEditingIndex(null)
    setSelectedTools(new Set())
  }

  const startEdit = (index: number) => {
    const agent = agents[index]
    if (agent.isModelAgent) return // Don't allow editing model agents
    setEditingAgent({ ...agent })
    setEditingIndex(index)
    setSelectedTools(new Set(agent.tools || []))
  }

  const removeAgent = (index: number) => {
    // Don't allow removing model agents or built-in agents
    const agent = agents[index]
    if (agent.isModelAgent || ['code-reviewer', 'debugger'].includes(agent.name)) return
    
    onChange(agents.filter((_, i) => i !== index))
    if (editingIndex === index) {
      cancelEdit()
    }
  }

  const toggleTool = (tool: string) => {
    const newTools = new Set(selectedTools)
    if (newTools.has(tool)) {
      newTools.delete(tool)
    } else {
      newTools.add(tool)
    }
    setSelectedTools(newTools)
  }

  const getAgentIcon = (agent: SubAgent) => {
    if (agent.name === 'gemini-context') return Globe
    if (agent.name === 'qwen-automation') return Cpu
    if (agent.name === 'codex-executor') return Zap
    if (agent.name === 'code-reviewer') return Code
    if (agent.name === 'debugger') return Search
    return Brain
  }

  const getAgentColor = (agent: SubAgent) => {
    if (agent.name === 'gemini-context') return '#4285f4'
    if (agent.name === 'qwen-automation') return '#ff6b00'
    if (agent.name === 'codex-executor') return '#00a67e'
    if (agent.name === 'code-reviewer') return '#3b82f6'
    if (agent.name === 'debugger') return '#ef4444'
    return '#6b7280'
  }

  // Separate model agents from regular agents
  const modelAgents = agents.filter(a => a.isModelAgent)
  const claudeAgents = agents.filter(a => !a.isModelAgent)

  return (
    <div className="agents-config">
      {/* Model Agents Section - Prominent at the top */}
      <div className="model-agents-section">
        <div className="section-header">
          <h3>AI Model Agents</h3>
          <p>Enable additional AI models to expand Claude's capabilities</p>
        </div>
        
        <div className="model-agents-grid">
          {modelAgents.map((agent) => {
            const Icon = getAgentIcon(agent)
            const color = getAgentColor(agent)
            const actualIndex = agents.indexOf(agent)
            
            return (
              <div key={agent.name} className={`model-agent-card ${agent.enabled ? 'enabled' : ''}`}>
                <div className="model-agent-header">
                  <div className="model-agent-icon" style={{ backgroundColor: `${color}15`, color }}>
                    <Icon size={32} />
                  </div>
                  <button
                    className={`model-toggle-btn ${agent.enabled ? 'active' : ''}`}
                    onClick={() => toggleModelAgent(actualIndex)}
                  >
                    {agent.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                  </button>
                </div>
                <h4>{agent.name.replace('-', ' ').toUpperCase()}</h4>
                <p>{agent.description}</p>
                <div className="model-agent-status">
                  {agent.enabled ? (
                    <span className="status-enabled">✓ Enabled</span>
                  ) : (
                    <span className="status-disabled">Disabled</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Divider */}
      <div className="agents-divider" />

      {/* Claude Agents Section */}
      <div className="claude-agents-section">
        <div className="section-header">
          <h3>Claude Sub-Agents</h3>
          <button className="settings-btn primary" onClick={addCustomAgent}>
            <Plus size={16} />
            Add Custom Agent
          </button>
        </div>

        {editingAgent && editingIndex !== null && (
          <div className="agent-editor-card">
            <div className="agent-editor-header">
              <h5>{editingIndex === -1 ? 'New Agent' : 'Edit Agent'}</h5>
              <div className="agent-editor-actions">
                <button className="settings-btn-icon save" onClick={saveAgent}>
                  <Check size={16} />
                </button>
                <button className="settings-btn-icon cancel" onClick={cancelEdit}>
                  <X size={16} />
                </button>
              </div>
            </div>
            
            <div className="agent-editor-body">
              <div className="agent-field">
                <label>Name</label>
                <input
                  className="agent-input"
                  placeholder="e.g., test-writer"
                  value={editingAgent.name}
                  onChange={(e) => setEditingAgent({ ...editingAgent, name: e.target.value })}
                />
              </div>
              
              <div className="agent-field">
                <label>Description</label>
                <input
                  className="agent-input"
                  placeholder="What does this agent do?"
                  value={editingAgent.description}
                  onChange={(e) => setEditingAgent({ ...editingAgent, description: e.target.value })}
                />
              </div>
              
              <div className="agent-field">
                <label>Tools</label>
                <div className="agent-tools-grid">
                  {AVAILABLE_TOOLS.map(tool => (
                    <button
                      key={tool}
                      className={`agent-tool-chip ${selectedTools.has(tool) ? 'selected' : ''}`}
                      onClick={() => toggleTool(tool)}
                    >
                      {tool}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="agent-field">
                <label>System Prompt</label>
                <textarea
                  className="agent-textarea"
                  placeholder="Define the agent's behavior..."
                  value={editingAgent.systemPrompt}
                  onChange={(e) => setEditingAgent({ ...editingAgent, systemPrompt: e.target.value })}
                  rows={4}
                />
              </div>
            </div>
          </div>
        )}

        <div className="claude-agents-list">
          {claudeAgents.map((agent) => {
            const Icon = getAgentIcon(agent)
            const color = getAgentColor(agent)
            const actualIndex = agents.indexOf(agent)
            
            if (editingIndex === actualIndex) return null
            
            return (
              <div key={agent.name} className="claude-agent-card">
                <div className="agent-icon" style={{ backgroundColor: `${color}15`, color }}>
                  <Icon size={20} />
                </div>
                <div className="agent-info">
                  <h5>{agent.name}</h5>
                  <p>{agent.description}</p>
                </div>
                <div className="agent-actions">
                  {!['code-reviewer', 'debugger'].includes(agent.name) && (
                    <>
                      <button className="settings-btn-icon edit" onClick={() => startEdit(actualIndex)}>
                        <Edit3 size={14} />
                      </button>
                      <button className="settings-btn-icon remove" onClick={() => removeAgent(actualIndex)}>
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}