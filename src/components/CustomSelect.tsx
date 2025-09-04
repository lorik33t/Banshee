import { ChevronDown } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

interface Option {
  value: string
  label: string
  description?: string
}

interface CustomSelectProps {
  value: string
  onChange: (value: string) => void
  options: Option[]
  placeholder?: string
}

export function CustomSelect({ value, onChange, options, placeholder = 'Select...' }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  
  const selectedOption = options.find(opt => opt.value === value)
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  
  return (
    <div className="custom-select" ref={dropdownRef}>
      <button
        type="button"
        className="custom-select-button"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="custom-select-value">
          {selectedOption ? (
            <>
              <span className="custom-select-label">{selectedOption.label}</span>
              {selectedOption.description && (
                <span className="custom-select-desc">{selectedOption.description}</span>
              )}
            </>
          ) : (
            <span className="custom-select-placeholder">{placeholder}</span>
          )}
        </div>
        <ChevronDown 
          size={16} 
          className={`custom-select-chevron ${isOpen ? 'open' : ''}`}
        />
      </button>
      
      {isOpen && (
        <div className="custom-select-dropdown">
          {options.map((option) => (
            <button
              key={option.value}
              className={`custom-select-option ${value === option.value ? 'selected' : ''}`}
              onClick={() => {
                onChange(option.value)
                setIsOpen(false)
              }}
            >
              <span className="custom-select-label">{option.label}</span>
              {option.description && (
                <span className="custom-select-desc">{option.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}