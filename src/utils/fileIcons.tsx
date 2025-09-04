import { 
  FileCode2, FileText, FileJson, Image, Film, Music, 
  Archive, Database, Lock, Settings, Terminal, Package,
  FileType, Folder, FolderOpen 
} from 'lucide-react'

const fileExtensionMap: Record<string, { icon: any; color?: string }> = {
  // Code files
  'js': { icon: FileCode2, color: '#f7df1e' },
  'jsx': { icon: FileCode2, color: '#61dafb' },
  'ts': { icon: FileCode2, color: '#3178c6' },
  'tsx': { icon: FileCode2, color: '#3178c6' },
  'py': { icon: FileCode2, color: '#3776ab' },
  'java': { icon: FileCode2, color: '#007396' },
  'cpp': { icon: FileCode2, color: '#00599c' },
  'c': { icon: FileCode2, color: '#a8b9cc' },
  'cs': { icon: FileCode2, color: '#239120' },
  'rb': { icon: FileCode2, color: '#cc342d' },
  'go': { icon: FileCode2, color: '#00add8' },
  'rs': { icon: FileCode2, color: '#dea584' },
  'php': { icon: FileCode2, color: '#777bb4' },
  'swift': { icon: FileCode2, color: '#fa7343' },
  
  // Web files
  'html': { icon: FileCode2, color: '#e34c26' },
  'css': { icon: FileCode2, color: '#1572b6' },
  'scss': { icon: FileCode2, color: '#cc6699' },
  'sass': { icon: FileCode2, color: '#cc6699' },
  'vue': { icon: FileCode2, color: '#4fc08d' },
  'svelte': { icon: FileCode2, color: '#ff3e00' },
  
  // Config files
  'json': { icon: FileJson, color: '#ffd93d' },
  'yaml': { icon: Settings, color: '#cb171e' },
  'yml': { icon: Settings, color: '#cb171e' },
  'toml': { icon: Settings, color: '#9c4121' },
  'xml': { icon: FileCode2, color: '#ff6600' },
  'env': { icon: Lock, color: '#ECD53F' },
  
  // Documentation
  'md': { icon: FileText, color: '#083fa1' },
  'mdx': { icon: FileText, color: '#083fa1' },
  'txt': { icon: FileText },
  'pdf': { icon: FileText, color: '#ff0000' },
  'doc': { icon: FileText, color: '#2b579a' },
  'docx': { icon: FileText, color: '#2b579a' },
  
  // Data files
  'csv': { icon: Database, color: '#40a02b' },
  'sql': { icon: Database, color: '#336791' },
  'db': { icon: Database, color: '#336791' },
  
  // Media files
  'png': { icon: Image, color: '#40a02b' },
  'jpg': { icon: Image, color: '#40a02b' },
  'jpeg': { icon: Image, color: '#40a02b' },
  'gif': { icon: Image, color: '#40a02b' },
  'svg': { icon: Image, color: '#ffb13b' },
  'mp4': { icon: Film, color: '#ff0000' },
  'mp3': { icon: Music, color: '#e74c3c' },
  
  // Archives
  'zip': { icon: Archive, color: '#f4a261' },
  'tar': { icon: Archive, color: '#f4a261' },
  'gz': { icon: Archive, color: '#f4a261' },
  
  // Shell
  'sh': { icon: Terminal, color: '#4eaa25' },
  'bash': { icon: Terminal, color: '#4eaa25' },
  'zsh': { icon: Terminal, color: '#4eaa25' },
  
  // Package files
  'package.json': { icon: Package, color: '#cb3837' },
  'Cargo.toml': { icon: Package, color: '#dea584' },
  'Gemfile': { icon: Package, color: '#cc342d' },
  'requirements.txt': { icon: Package, color: '#3776ab' },
}

const specialFileMap: Record<string, { icon: any; color?: string }> = {
  '.gitignore': { icon: FileText, color: '#f14e32' },
  '.env': { icon: Lock, color: '#ECD53F' },
  '.env.local': { icon: Lock, color: '#ECD53F' },
  '.env.development': { icon: Lock, color: '#ECD53F' },
  '.env.production': { icon: Lock, color: '#ECD53F' },
  'Dockerfile': { icon: FileCode2, color: '#2496ed' },
  'docker-compose.yml': { icon: FileCode2, color: '#2496ed' },
  'package.json': { icon: Package, color: '#cb3837' },
  'package-lock.json': { icon: Lock, color: '#cb3837' },
  'yarn.lock': { icon: Lock, color: '#2c8ebb' },
  'tsconfig.json': { icon: Settings, color: '#3178c6' },
  'webpack.config.js': { icon: Settings, color: '#8dd6f9' },
  'vite.config.js': { icon: Settings, color: '#646cff' },
  'vite.config.ts': { icon: Settings, color: '#646cff' },
  'README.md': { icon: FileText, color: '#083fa1' },
  'LICENSE': { icon: FileText, color: '#0e7490' },
}

export function getFileIcon(filename: string): { icon: any; color?: string } {
  // Check for special files first
  if (specialFileMap[filename]) {
    return specialFileMap[filename]
  }
  
  // Get file extension
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext && fileExtensionMap[ext]) {
    return fileExtensionMap[ext]
  }
  
  // Default icon
  return { icon: FileType }
}

export function getFolderIcon(isOpen: boolean): { icon: any; color?: string } {
  return { 
    icon: isOpen ? FolderOpen : Folder, 
    color: '#90a4ae' 
  }
}