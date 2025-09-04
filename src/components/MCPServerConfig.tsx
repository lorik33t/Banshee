import { Plus, Trash2, Server, Github, HardDrive, MessageSquare, Search, Brain, Edit3, Check, X, FolderOpen, Key } from 'lucide-react'
import { useState } from 'react'

interface MCPServer {
  command: string
  args?: string[]
  env?: Record<string, string>
  type?: 'stdio' | 'sse' | 'http'
  url?: string
}

interface MCPServerConfigProps {
  servers: Record<string, MCPServer>
  onChange: (servers: Record<string, MCPServer>) => void
}

const SERVER_TEMPLATES = {
  filesystem: {
    name: 'Filesystem',
    icon: HardDrive,
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      type: 'stdio' as const
    },
    description: 'Access local files and directories',
    setup: 'Add paths as additional arguments'
  },
  github: {
    name: 'GitHub',
    icon: Github,
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
      type: 'stdio' as const
    },
    description: 'Manage issues, PRs, and repositories',
    setup: 'Requires GitHub personal access token'
  },
  slack: {
    name: 'Slack',
    icon: MessageSquare,
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: {
        SLACK_BOT_TOKEN: '',
        SLACK_WORKSPACE_ID: '',
        SLACK_CHANNEL_ID: ''
      },
      type: 'stdio' as const
    },
    description: 'Send messages and read channels',
    setup: 'Requires Slack bot token and workspace/channel IDs'
  },
  brave: {
    name: 'Brave Search',
    icon: Search,
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: '' },
      type: 'stdio' as const
    },
    description: 'Web search capabilities',
    setup: 'Requires Brave Search API key'
  },
  sequential: {
    name: 'Sequential Thinking',
    icon: Brain,
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      type: 'stdio' as const
    },
    description: 'Step-by-step problem solving',
    setup: 'No additional configuration needed'
  }
}

export function MCPServerConfig({ servers, onChange }: MCPServerConfigProps) {
  const [editingServer, setEditingServer] = useState<string | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [editingName, setEditingName] = useState<string>('')
  const [editingConfig, setEditingConfig] = useState<MCPServer | null>(null)
  const [addingPath, setAddingPath] = useState<string>('')

  const addServer = (templateKey: string) => {
    const template = SERVER_TEMPLATES[templateKey as keyof typeof SERVER_TEMPLATES]
    const baseName = templateKey
    let name = baseName
    let counter = 1
    while (servers[name]) {
      name = `${baseName}-${counter}`
      counter++
    }
    
    onChange({
      ...servers,
      [name]: { ...template.config }
    })
    setShowAddMenu(false)
    setEditingServer(name)
    setEditingName(name)
    setEditingConfig({ ...template.config })
  }

  const removeServer = (name: string) => {
    const newServers = { ...servers }
    delete newServers[name]
    onChange(newServers)
    if (editingServer === name) {
      setEditingServer(null)
      setEditingConfig(null)
    }
  }

  const saveServer = () => {
    if (editingServer && editingConfig) {
      const newServers = { ...servers }
      // If name changed, delete old and add new
      if (editingName !== editingServer) {
        delete newServers[editingServer]
      }
      newServers[editingName] = editingConfig
      onChange(newServers)
      setEditingServer(null)
      setEditingConfig(null)
    }
  }

  const cancelEdit = () => {
    setEditingServer(null)
    setEditingConfig(null)
    setEditingName('')
  }

  const updateEnvVar = (key: string, value: string) => {
    if (editingConfig) {
      setEditingConfig({
        ...editingConfig,
        env: {
          ...editingConfig.env,
          [key]: value
        }
      })
    }
  }

  const addPath = () => {
    if (editingConfig && addingPath) {
      setEditingConfig({
        ...editingConfig,
        args: [...(editingConfig.args || []), addingPath]
      })
      setAddingPath('')
    }
  }

  const removePath = (index: number) => {
    if (editingConfig && editingConfig.args) {
      const newArgs = [...editingConfig.args]
      newArgs.splice(index, 1)
      setEditingConfig({
        ...editingConfig,
        args: newArgs
      })
    }
  }

  const getServerIcon = (name: string) => {
    // Try to match with template
    for (const [key, template] of Object.entries(SERVER_TEMPLATES)) {
      if (name.startsWith(key)) {
        return template.icon
      }
    }
    return Server
  }

  return (
    <div className="mcp-config">
      <div className="mcp-header">
        <div className="mcp-title">
          <h4>MCP Servers</h4>
          <span className="mcp-count">{Object.keys(servers).length} configured</span>
        </div>
        <button 
          className="settings-btn primary"
          onClick={() => setShowAddMenu(!showAddMenu)}
        >
          <Plus size={16} />
          Add Server
        </button>
      </div>

      {showAddMenu && (
        <div className="mcp-templates-grid">
          {Object.entries(SERVER_TEMPLATES).map(([key, template]) => {
            const Icon = template.icon
            return (
              <button
                key={key}
                className="mcp-template-card"
                onClick={() => addServer(key)}
              >
                <div className="mcp-template-icon">
                  <Icon size={24} />
                </div>
                <div className="mcp-template-content">
                  <h5>{template.name}</h5>
                  <p>{template.description}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <div className="mcp-servers-list">
        {Object.entries(servers).map(([name, config]) => {
          const Icon = getServerIcon(name)
          const isEditing = editingServer === name
          
          if (isEditing && editingConfig) {
            return (
              <div key={name} className="mcp-server-card editing">
                <div className="mcp-server-edit-header">
                  <Icon size={20} />
                  <input
                    className="mcp-server-name-input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    placeholder="Server name"
                  />
                  <div className="mcp-server-actions">
                    <button className="settings-btn-icon save" onClick={saveServer}>
                      <Check size={16} />
                    </button>
                    <button className="settings-btn-icon cancel" onClick={cancelEdit}>
                      <X size={16} />
                    </button>
                  </div>
                </div>
                
                <div className="mcp-server-edit-body">
                  <div className="mcp-field">
                    <label>Command</label>
                    <div className="mcp-input-group">
                      <input 
                        value={editingConfig.command}
                        onChange={(e) => setEditingConfig({ ...editingConfig, command: e.target.value })}
                        placeholder="e.g., npx"
                      />
                    </div>
                  </div>
                  
                  {editingConfig.env && Object.keys(editingConfig.env).length > 0 && (
                    <div className="mcp-field">
                      <label>Environment Variables</label>
                      <div className="mcp-env-list">
                        {Object.entries(editingConfig.env).map(([key, value]) => (
                          <div key={key} className="mcp-env-item">
                            <div className="mcp-env-key">
                              <Key size={14} />
                              {key}
                            </div>
                            <input
                              type="password"
                              className="mcp-env-input"
                              value={value}
                              onChange={(e) => updateEnvVar(key, e.target.value)}
                              placeholder={`Enter ${key}`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {name.startsWith('filesystem') && (
                    <div className="mcp-field">
                      <label>Accessible Paths</label>
                      <div className="mcp-paths-list">
                        {editingConfig.args?.slice(2).map((path, i) => (
                          <div key={i} className="mcp-path-item">
                            <FolderOpen size={14} />
                            <span>{path}</span>
                            <button 
                              className="settings-btn-icon remove"
                              onClick={() => removePath(i + 2)}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        <div className="mcp-add-path">
                          <input
                            value={addingPath}
                            onChange={(e) => setAddingPath(e.target.value)}
                            placeholder="Add path (e.g., ~/Documents)"
                            onKeyPress={(e) => e.key === 'Enter' && addPath()}
                          />
                          <button 
                            className="settings-btn-icon add"
                            onClick={addPath}
                            disabled={!addingPath}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          }
          
          return (
            <div key={name} className="mcp-server-card">
              <div className="mcp-server-header">
                <Icon size={20} />
                <div className="mcp-server-info">
                  <h5>{name}</h5>
                  <span className="mcp-server-command">{config.command} {config.args?.slice(0, 2).join(' ')}</span>
                </div>
                <div className="mcp-server-actions">
                  <button 
                    className="settings-btn-icon edit"
                    onClick={() => {
                      setEditingServer(name)
                      setEditingName(name)
                      setEditingConfig({ ...config })
                    }}
                  >
                    <Edit3 size={14} />
                  </button>
                  <button 
                    className="settings-btn-icon remove"
                    onClick={() => removeServer(name)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              
              {config.env && Object.keys(config.env).filter(k => config.env![k]).length > 0 && (
                <div className="mcp-server-status configured">
                  <Check size={12} />
                  Configured
                </div>
              )}
              
              {config.env && Object.keys(config.env).filter(k => !config.env![k]).length > 0 && (
                <div className="mcp-server-status needs-config">
                  <X size={12} />
                  Needs configuration
                </div>
              )}
            </div>
          )
        })}
      </div>

      {Object.keys(servers).length === 0 && !showAddMenu && (
        <div className="mcp-empty-state">
          <Server size={48} />
          <h5>No MCP servers configured</h5>
          <p>Add servers to extend Claude's capabilities with external tools</p>
          <button className="settings-btn primary" onClick={() => setShowAddMenu(true)}>
            <Plus size={20} />
            Get Started
          </button>
        </div>
      )}
    </div>
  )
}