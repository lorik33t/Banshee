import { forwardRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'

interface CustomTextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  label?: string
  description?: string
  value: string
  onChange: (value: string) => void
  error?: string
}

export const CustomTextArea = forwardRef<HTMLTextAreaElement, CustomTextAreaProps>(
  ({ label, description, value, onChange, error, className = '', ...props }, ref) => {
    return (
      <div className="custom-textarea-container">
        {label && (
          <div className="custom-textarea-label">
            <span>{label}</span>
            {description && <small>{description}</small>}
          </div>
        )}
        <textarea
          ref={ref}
          className={`custom-textarea ${error ? 'error' : ''} ${className}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...props}
        />
        {error && <span className="custom-textarea-error">{error}</span>}
      </div>
    )
  }
)

CustomTextArea.displayName = 'CustomTextArea'