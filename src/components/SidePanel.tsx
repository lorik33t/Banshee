import { X } from 'lucide-react'
import { FileTree } from './FileTree'
import { DiffPanel } from './DiffPanel'

interface SidePanelProps {
  content: 'files' | 'diff'
  onClose: () => void
}

export function SidePanel({ content, onClose }: SidePanelProps) {
  const getTitle = () => {
    switch (content) {
      case 'files': return 'Files'
      case 'diff': return 'Changes'
    }
  }

  const renderContent = () => {
    switch (content) {
      case 'files':
        return <FileTree />
      case 'diff':
        return <DiffPanel />
    }
  }

  return (
    <div className="side-panel">
      <div className="side-panel-header">
        <h3>{getTitle()}</h3>
        <button className="close-btn" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="side-panel-content">
        {renderContent()}
      </div>
    </div>
  )
}