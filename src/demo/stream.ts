import { useEffect } from 'react'
import { useSession } from '../state/session'

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

export function useDemoStream(enabled = true) {
  const push = useSession((s) => s.pushEvent)

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    ;(async () => {
      const now = Date.now()
      push({ id: 'm1', type: 'message', role: 'assistant', text: 'Hello! I can help with your repo.', ts: now })
      await sleep(300)
      push({ id: 'm2', type: 'message', role: 'user', text: 'Find TODOs and list them.', ts: now + 300 })
      await sleep(400)
      push({ id: 't1', type: 'tool:start', tool: 'grep', args: { pattern: 'TODO' }, ts: now + 700 })
      for (let i = 0; i < 3; i++) {
        if (stopped) return
        push({ id: 't1', type: 'tool:output', chunk: `./src/file${i}.ts:12: // TODO: fix\n`, ts: now + 800 + i * 120 })
        await sleep(120)
      }
      push({ id: 't1', type: 'tool:output', chunk: `-- done --`, done: true, ts: now + 1300 })
      await sleep(400)
      push({ id: 'm3', type: 'message', role: 'assistant', text: 'I found 3 TODOs. I can create issues or fix them.', ts: now + 1800 })
      await sleep(500)
      push({ id: 'e1', type: 'edit:proposed', file: 'src/utils/math.ts', before: 'export const add = (a,b)=>a+b', after: 'export function add(a: number, b: number): number {\n  return a + b;\n}', ts: now + 2300 })
    })()
    return () => { stopped = true }
  }, [enabled, push])
}
