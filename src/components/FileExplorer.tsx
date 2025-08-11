import { useEffect, useState } from 'react'
import { readDir } from '@tauri-apps/plugin-fs'
import { FileCode2, Folder, ChevronRight } from 'lucide-react'
import { useSession } from '../state/session'

type Node = { path: string; name: string; kind: 'file' | 'dir'; children?: Node[]; open?: boolean }

async function listDir(root: string, dir: string): Promise<Node[]> {
  const entries = await readDir(`${root}/${dir}`).catch(() => [])
  const nodes: Node[] = []
  for (const e of entries as any[]) {
    const name = e.name as string
    const isDir = e.isDirectory as boolean
    nodes.push({ path: `${dir ? dir + '/' : ''}${name}`, name, kind: isDir ? 'dir' : 'file' })
  }
  return nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
}

export function FileExplorer() {
  const projectDir = useSession((s) => s.projectDir)
  const [tree, setTree] = useState<Node[]>([])

  useEffect(() => {
    if (!projectDir) { setTree([]); return }
    listDir(projectDir, '').then(setTree)
  }, [projectDir])

  async function toggle(node: Node) {
    if (node.kind !== 'dir') return
    node.open = !node.open
    if (node.open && !node.children) {
      node.children = await listDir(projectDir!, node.path)
    }
    setTree([...tree])
  }

  function render(nodes: Node[], depth = 0) {
    return nodes.map((n) => (
      <div key={n.path} style={{ paddingLeft: depth * 12 }}>
        <div className="tree-item" onClick={() => toggle(n)}>
          {n.kind === 'dir' ? <ChevronRight size={14} style={{ opacity: 0.7, transform: n.open ? 'rotate(90deg)' : 'none', transition: '120ms' }} /> : <span style={{ width: 14 }} />}
          {n.kind === 'dir' ? <Folder size={14} /> : <FileCode2 size={14} />}
          <span style={{ fontSize: 13 }}>{n.name}</span>
        </div>
        {n.open && n.children && (
          <div>{render(n.children, depth + 1)}</div>
        )}
      </div>
    ))
  }

  return (
    <div className="explorer">
      <div className="header">
        <Folder size={16} />
        <div style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {projectDir || 'No project'}
        </div>
      </div>
      <div className="tree">
        {projectDir ? render(tree) : <div className="tree-item">Select a project to view files</div>}
      </div>
    </div>
  )
}
