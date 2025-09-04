import { readDir, exists, BaseDirectory } from '@tauri-apps/plugin-fs'
import { path } from '@tauri-apps/api'

export interface DiagnosticResult {
  test: string
  success: boolean
  result?: any
  error?: string
  duration: number
}

export async function runTauriFileSystemDiagnostics(testPath: string): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = []
  
  // Test 1: Check Tauri availability
  const test1Start = performance.now()
  try {
    const tauriAvailable = !!(window as any).__TAURI__
    results.push({
      test: 'Tauri API Available',
      success: tauriAvailable,
      result: tauriAvailable ? 'Tauri is available' : 'Tauri not found',
      duration: performance.now() - test1Start
    })
  } catch (e) {
    results.push({
      test: 'Tauri API Available',
      success: false,
      error: String(e),
      duration: performance.now() - test1Start
    })
  }
  
  // Test 2: Check fs plugin functions
  const test2Start = performance.now()
  try {
    const hasReadDir = typeof readDir === 'function'
    const hasExists = typeof exists === 'function'
    results.push({
      test: 'FS Plugin Functions',
      success: hasReadDir && hasExists,
      result: { readDir: hasReadDir, exists: hasExists },
      duration: performance.now() - test2Start
    })
  } catch (e) {
    results.push({
      test: 'FS Plugin Functions',
      success: false,
      error: String(e),
      duration: performance.now() - test2Start
    })
  }
  
  // Test 3: Check path normalization
  const test3Start = performance.now()
  try {
    const normalized = await path.normalize(testPath)
    results.push({
      test: 'Path Normalization',
      success: true,
      result: { original: testPath, normalized },
      duration: performance.now() - test3Start
    })
  } catch (e) {
    results.push({
      test: 'Path Normalization',
      success: false,
      error: String(e),
      duration: performance.now() - test3Start
    })
  }
  
  // Test 4: Check if path exists
  const test4Start = performance.now()
  try {
    const pathExists = await exists(testPath)
    results.push({
      test: 'Path Exists Check',
      success: true,
      result: { path: testPath, exists: pathExists },
      duration: performance.now() - test4Start
    })
  } catch (e) {
    results.push({
      test: 'Path Exists Check',
      success: false,
      error: String(e),
      duration: performance.now() - test4Start
    })
  }
  
  // Test 5: Try to read home directory
  const test5Start = performance.now()
  try {
    const homeEntries = await readDir('/', { baseDir: BaseDirectory.Home })
    results.push({
      test: 'Read Home Directory',
      success: true,
      result: `Found ${homeEntries.length} entries in home directory`,
      duration: performance.now() - test5Start
    })
  } catch (e) {
    results.push({
      test: 'Read Home Directory',
      success: false,
      error: String(e),
      duration: performance.now() - test5Start
    })
  }
  
  // Test 6: Try to read the specified path
  const test6Start = performance.now()
  try {
    const entries = await readDir(testPath)
    results.push({
      test: 'Read Target Directory',
      success: true,
      result: `Found ${entries.length} entries in ${testPath}`,
      duration: performance.now() - test6Start
    })
  } catch (e) {
    results.push({
      test: 'Read Target Directory',
      success: false,
      error: String(e),
      duration: performance.now() - test6Start
    })
  }
  
  // Test 7: Check path components
  const test7Start = performance.now()
  try {
    const pathParts = testPath.split('/')
    const componentResults = []
    let currentPath = ''
    
    for (const part of pathParts) {
      if (part) {
        currentPath = currentPath ? `${currentPath}/${part}` : `/${part}`
        try {
          const pathExists = await exists(currentPath)
          componentResults.push({ path: currentPath, exists: pathExists })
          if (!pathExists) break
        } catch (e) {
          componentResults.push({ path: currentPath, error: String(e) })
          break
        }
      }
    }
    
    results.push({
      test: 'Path Component Check',
      success: true,
      result: componentResults,
      duration: performance.now() - test7Start
    })
  } catch (e) {
    results.push({
      test: 'Path Component Check',
      success: false,
      error: String(e),
      duration: performance.now() - test7Start
    })
  }
  
  return results
}

export function formatDiagnosticResults(results: DiagnosticResult[]): string {
  let output = 'Tauri File System Diagnostics\n'
  output += '============================\n\n'
  
  for (const result of results) {
    output += `Test: ${result.test}\n`
    output += `Status: ${result.success ? '✅ PASS' : '❌ FAIL'}\n`
    output += `Duration: ${result.duration.toFixed(2)}ms\n`
    
    if (result.result) {
      output += `Result: ${typeof result.result === 'object' ? JSON.stringify(result.result, null, 2) : result.result}\n`
    }
    
    if (result.error) {
      output += `Error: ${result.error}\n`
    }
    
    output += '\n'
  }
  
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0)
  const passedTests = results.filter(r => r.success).length
  
  output += `Summary: ${passedTests}/${results.length} tests passed\n`
  output += `Total duration: ${totalDuration.toFixed(2)}ms\n`
  
  return output
}