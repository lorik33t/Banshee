import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { CustomInput } from './CustomInput'

export function CodexPanel() {
  const [repoArgs, setRepoArgs] = useState('')
  const [repoOutput, setRepoOutput] = useState('')
  const [runArgs, setRunArgs] = useState('')
  const [runOutput, setRunOutput] = useState('')

  const handleRepo = async () => {
    try {
      const args = repoArgs.trim() ? repoArgs.split(/\s+/) : []
      const result = await invoke<string>('codex_repo', { args })
      setRepoOutput(result)
    } catch (e) {
      setRepoOutput(String(e))
    }
  }

  const handleRun = async () => {
    try {
      const args = runArgs.trim() ? runArgs.split(/\s+/) : []
      const result = await invoke<string>('codex_run', { args })
      setRunOutput(result)
    } catch (e) {
      setRunOutput(String(e))
    }
  }

  return (
    <div className="codex-panel">
      <section>
        <h3>Codex Repo</h3>
        <div className="codex-control">
          <div style={{ flex: 1 }}>
            <CustomInput
              value={repoArgs}
              onChange={(value) => setRepoArgs(String(value))}
              placeholder="arguments"
            />
          </div>
          <button className="welcome-action" onClick={handleRepo}>Run</button>
        </div>
        {repoOutput && <pre className="codex-output">{repoOutput}</pre>}
      </section>
      <section>
        <h3>Codex Run</h3>
        <div className="codex-control">
          <div style={{ flex: 1 }}>
            <CustomInput
              value={runArgs}
              onChange={(value) => setRunArgs(String(value))}
              placeholder="arguments"
            />
          </div>
          <button className="welcome-action" onClick={handleRun}>Run</button>
        </div>
        {runOutput && <pre className="codex-output">{runOutput}</pre>}
      </section>
    </div>
  )
}

export default CodexPanel
