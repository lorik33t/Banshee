import MonacoEditor from '@monaco-editor/react'
import type { OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useEffect, type ClipboardEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSettings } from '../state/settings'

interface EditorProps {
  language: string
  value: string
  onChange: (val: string) => void
  onKeyDown?: (e: monaco.IKeyboardEvent) => void
  onPaste?: (e: ClipboardEvent<HTMLDivElement>) => void
  onFocus?: () => void
  onBlur?: () => void
}

export function Editor({
  language,
  value,
  onChange,
  onKeyDown,
  onPaste,
  onFocus,
  onBlur
}: EditorProps) {
  const { settings } = useSettings()
  const lspPath = settings.lspServers?.[language]

  useEffect(() => {
    if (lspPath) {
      const initReq = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { capabilities: {}, rootUri: null }
      }
      invoke<string>('lsp_proxy', {
        language,
        cmd: lspPath,
        request: JSON.stringify(initReq)
      }).catch(() => {})
    }
  }, [language, lspPath])

  const handleChange = (val?: string) => {
    const v = val ?? ''
    onChange(v)
    if (lspPath) {
      const didChange = {
        jsonrpc: '2.0',
        id: 1,
        method: 'textDocument/didChange',
        params: { text: v }
      }
      invoke<string>('lsp_proxy', {
        language,
        cmd: lspPath,
        request: JSON.stringify(didChange)
      }).catch(() => {})
    }
  }

  const handleMount: OnMount = (editor) => {
    if (onKeyDown) {
      editor.onKeyDown(onKeyDown)
    }
    if (onFocus) {
      editor.onDidFocusEditorText(onFocus)
    }
    if (onBlur) {
      editor.onDidBlurEditorText(onBlur)
    }
  }

  return (
    <div onPaste={onPaste} style={{ width: '100%', height: '100%' }}>
      <MonacoEditor
        height="100%"
        language={language}
        value={value}
        onChange={handleChange}
        onMount={handleMount}
        options={{ minimap: { enabled: false }, automaticLayout: true }}
      />
    </div>
  )
}
