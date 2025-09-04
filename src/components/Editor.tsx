import { useEffect, useState, useCallback } from 'react'
import { Editor as MonacoEditor } from '@monaco-editor/react'
import { invoke } from '@tauri-apps/api/core'

interface EditorProps {
  path: string
}

export function Editor({ path }: EditorProps) {
  const [value, setValue] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      if (!(window as any).__TAURI__) return
      try {
        const content = await invoke<string>('load_file', { path })
        if (active) setValue(content)
      } catch (e) {
        console.error('Failed to load file', e)
      }
    }
    load()
    return () => { active = false }
  }, [path])

  const save = useCallback(async () => {
    if (!(window as any).__TAURI__) return
    try {
      await invoke('save_file', { path, content: value })
    } catch (e) {
      console.error('Failed to save file', e)
    }
  }, [path, value])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [save])

  const language = path.split('.').pop()

  return (
    <MonacoEditor
      path={path}
      theme="vs-dark"
      language={language}
      value={value}
      onChange={v => setValue(v ?? '')}
      options={{ minimap: { enabled: false } }}
      height="100%"
    />
  )
}
