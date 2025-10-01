import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../state/session'

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.DS_Store',
  '.idea',
  '.vscode',
  'dist',
  'build',
  'target',
  '.turbo',
])

const MAX_FILES = 5000

export function useProjectFiles() {
  const projectDir = useSession((s) => s.projectDir)
  const [files, setFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadKeyRef = useRef<string | null>(null)
  const abortRef = useRef(0)

  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).__TAURI__ || !projectDir) {
      setFiles([])
      setError(null)
      setLoading(false)
      loadKeyRef.current = null
      return
    }

    if (loadKeyRef.current === projectDir && files.length) {
      return
    }

    let isCancelled = false
    const currentToken = ++abortRef.current

    const loadFiles = async () => {
      setLoading(true)
      setError(null)
      try {
        const fs = await import('@tauri-apps/plugin-fs')
        const pathApi = await import('@tauri-apps/api/path')

        const pending: Array<{ absolute: string; relative: string }> = [
          { absolute: projectDir, relative: '' },
        ]
        const discovered: string[] = []

        while (pending.length && discovered.length < MAX_FILES) {
          const next = pending.pop()
          if (!next) continue

          let entries: any[]
          try {
            entries = (await fs.readDir(next.absolute)) as any[]
          } catch (err) {
            console.warn('[useProjectFiles] Failed to read dir', next.absolute, err)
            continue
          }

          for (const entry of entries) {
            const name = entry?.name as string | undefined
            if (!name) continue
            if (IGNORED_DIRS.has(name)) continue

            const relativePath = next.relative ? `${next.relative}/${name}` : name
            const absolutePath = await pathApi.join(next.absolute, name)

            if (entry?.isDirectory) {
              pending.push({ absolute: absolutePath, relative: relativePath })
              continue
            }

            discovered.push(relativePath)
            if (discovered.length >= MAX_FILES) break
          }
        }

        if (isCancelled || abortRef.current !== currentToken) {
          return
        }

        discovered.sort((a, b) => a.localeCompare(b))
        setFiles(discovered)
        loadKeyRef.current = projectDir
      } catch (err) {
        if (isCancelled || abortRef.current !== currentToken) {
          return
        }
        console.error('[useProjectFiles] Failed to enumerate project files', err)
        setFiles([])
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!isCancelled && abortRef.current === currentToken) {
          setLoading(false)
        }
      }
    }

    loadFiles()

    return () => {
      isCancelled = true
    }
  }, [projectDir, files.length])

  return useMemo(
    () => ({ files, loading, error, hasProject: Boolean(projectDir) }),
    [files, loading, error, projectDir]
  )
}
