import { Check, X } from 'lucide-react'

interface ToggleSwitchProps {
  value: boolean
  onChange: (value: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
}

export function ToggleSwitch({ value, onChange, label, description, disabled = false }: ToggleSwitchProps) {
  return (
    <div className="toggle-switch-container">
      <button
        className={`toggle-switch ${value ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={() => !disabled && onChange(!value)}
        disabled={disabled}
        type="button"
      >
        <span className="toggle-slider" />
        {value ? (
          <Check size={12} className="toggle-icon active" />
        ) : (
          <X size={12} className="toggle-icon inactive" />
        )}
      </button>
      {(label || description) && (
        <div className="toggle-label">
          {label && <span className="toggle-label-text">{label}</span>}
          {description && <span className="toggle-description">{description}</span>}
        </div>
      )}
    </div>
  )
}