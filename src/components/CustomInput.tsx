import { Plus, Minus } from 'lucide-react'
import { useState, useEffect } from 'react'

interface CustomInputProps {
  value: string | number
  onChange: (value: string | number) => void
  type?: 'text' | 'number' | 'password'
  placeholder?: string
  label?: string
  description?: string
  unit?: string
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  icon?: React.ReactNode
}

export function CustomInput({
  value,
  onChange,
  type = 'text',
  placeholder,
  label,
  description,
  unit,
  min,
  max,
  step = 1,
  disabled = false,
  icon
}: CustomInputProps) {
  const [localValue, setLocalValue] = useState(value)
  
  useEffect(() => {
    setLocalValue(value)
  }, [value])
  
  const handleChange = (newValue: string) => {
    if (type === 'number') {
      const num = parseFloat(newValue)
      if (!isNaN(num)) {
        if (min !== undefined && num < min) return
        if (max !== undefined && num > max) return
      }
    }
    setLocalValue(newValue)
    onChange(newValue)
  }
  
  const increment = () => {
    const current = Number(localValue) || 0
    const next = current + step
    if (max === undefined || next <= max) {
      handleChange(String(next))
    }
  }
  
  const decrement = () => {
    const current = Number(localValue) || 0
    const next = current - step
    if (min === undefined || next >= min) {
      handleChange(String(next))
    }
  }
  
  return (
    <div className="custom-input-container">
      {label && (
        <label className="setting-label">
          {label}
          {description && <small>{description}</small>}
        </label>
      )}
      <div className="custom-input-wrapper">
        {icon && <span className="custom-input-icon">{icon}</span>}
        <input
          className="custom-input"
          type={type === 'password' ? 'password' : 'text'}
          value={localValue}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
        {type === 'number' && (
          <div className="custom-input-controls">
            <button 
              className="custom-input-btn"
              onClick={decrement}
              disabled={disabled || (min !== undefined && Number(localValue) <= min)}
              type="button"
            >
              <Minus size={14} />
            </button>
            <button 
              className="custom-input-btn"
              onClick={increment}
              disabled={disabled || (max !== undefined && Number(localValue) >= max)}
              type="button"
            >
              <Plus size={14} />
            </button>
          </div>
        )}
        {unit && <span className="custom-input-unit">{unit}</span>}
      </div>
    </div>
  )
}