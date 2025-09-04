import { ChevronDown, Sparkles, Zap, Gauge } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

type ModelOption = {
  value: string
  label: string
  description?: string
  icon?: 'sparkles' | 'zap' | 'gauge'
} | {
  group: string
}

interface ModelSelectorProps {
  value: string
  onChange: (value: string) => void
}

const MODELS: ModelOption[] = [
  { value: '', label: 'Auto', description: 'Best available', icon: 'sparkles' },
  
  { group: 'Claude 4 Series' },
  { value: 'claude-opus-4-1', label: 'Claude Opus 4.1', description: 'Most capable', icon: 'sparkles' },
  { value: 'claude-sonnet-4', label: 'Claude Sonnet 4', description: 'Balanced', icon: 'zap' },
  
  { group: 'Claude 3.5 Series' },
  { value: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet', description: 'Fast & smart', icon: 'zap' },
  { value: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku', description: 'Lightning fast', icon: 'gauge' },
  
  { group: 'Claude 3 Series' },
  { value: 'claude-3-opus', label: 'Claude 3 Opus', description: 'Powerful', icon: 'sparkles' },
  { value: 'claude-3-sonnet', label: 'Claude 3 Sonnet', description: 'Balanced', icon: 'zap' },
  { value: 'claude-3-haiku', label: 'Claude 3 Haiku', description: 'Fast', icon: 'gauge' },
  
  { group: 'Google Gemini' },
  { value: 'gemini-pro', label: 'Gemini Pro', description: 'Advanced reasoning', icon: 'sparkles' },
  { value: 'gemini-flash', label: 'Gemini Flash', description: 'Fast responses', icon: 'gauge' },
  
  { group: 'Alibaba Qwen' },
  { value: 'qwen-plus', label: 'Qwen Plus', description: 'Enhanced capabilities', icon: 'sparkles' },
  { value: 'qwen-turbo', label: 'Qwen Turbo', description: 'Speed optimized', icon: 'gauge' },
  
  { group: 'OpenAI Codex' },
  { value: 'codex-mini', label: 'Codex Mini', description: 'Ultra-fast responses', icon: 'zap' },
  { value: 'codex-pro', label: 'Codex Pro', description: 'Advanced reasoning', icon: 'sparkles' },
]

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  
  const selectedModel = MODELS.find(m => 'value' in m && m.value === value) || MODELS[0]
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  
  const getIcon = (iconType?: string) => {
    switch (iconType) {
      case 'sparkles': return <Sparkles size={16} />
      case 'zap': return <Zap size={16} />
      case 'gauge': return <Gauge size={16} />
      default: return null
    }
  }
  
  return (
    <div className="model-selector" ref={dropdownRef}>
      <button
        type="button"
        className="model-selector-button"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="model-selector-value">
          {'icon' in selectedModel && getIcon(selectedModel.icon)}
          <div className="model-selector-text">
            <span className="model-name">{'label' in selectedModel ? selectedModel.label : ''}</span>
            {'description' in selectedModel && selectedModel.description && (
              <span className="model-desc">{selectedModel.description}</span>
            )}
          </div>
        </div>
        <ChevronDown 
          size={16} 
          className={`model-selector-chevron ${isOpen ? 'open' : ''}`}
        />
      </button>
      
      {isOpen && (
        <div className="model-selector-dropdown">
          {MODELS.map((model, index) => {
            if ('group' in model) {
              return (
                <div key={index} className="model-group-label">
                  {model.group}
                </div>
              )
            }
            
            return (
              <button
                key={model.value}
                className={`model-option ${value === model.value ? 'selected' : ''}`}
                onClick={() => {
                  onChange(model.value)
                  setIsOpen(false)
                }}
              >
                {getIcon(model.icon)}
                <div className="model-option-text">
                  <span className="model-name">{model.label}</span>
                  {model.description && (
                    <span className="model-desc">{model.description}</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}