import { execFile } from 'node:child_process'
import type { GitCommit, GitInfo } from '../shared/types'

const SEP = '\x1f'

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 10_000 },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    )
  })
}

/**
 * Asigna carriles a los commits para pintar el grafo (estilo GitHub/gitk):
 * cada carril "espera" un hash; el commit toma el carril que lo esperaba (o
 * uno libre), deja su primer padre en él y abre carriles para los demás.
 */
export function layoutLanes(
  commits: Omit<GitCommit, 'lane' | 'mergeLanes' | 'activeAfter' | 'closes'>[]
): GitCommit[] {
  const lanes: (string | null)[] = []
  return commits.map((c) => {
    let lane = lanes.findIndex((h) => h === c.hash)
    if (lane < 0) {
      lane = lanes.findIndex((h) => h === null)
      if (lane < 0) {
        lane = lanes.length
        lanes.push(null)
      }
    }
    // otros carriles que también esperaban este commit confluyen aquí (se cierran)
    const closes: number[] = []
    lanes.forEach((h, i) => {
      if (i !== lane && h === c.hash) {
        lanes[i] = null
        closes.push(i)
      }
    })
    lanes[lane] = c.parents[0] ?? null
    const mergeLanes: number[] = []
    for (const parent of c.parents.slice(1)) {
      let l2 = lanes.findIndex((h) => h === parent)
      if (l2 < 0) {
        l2 = lanes.findIndex((h) => h === null)
        if (l2 < 0) {
          l2 = lanes.length
          lanes.push(null)
        }
        lanes[l2] = parent
      }
      mergeLanes.push(l2)
    }
    const activeAfter = lanes
      .map((h, i) => (h !== null ? i : -1))
      .filter((i) => i >= 0)
    return { ...c, lane, mergeLanes, activeAfter, closes }
  })
}

export async function getGitInfo(cwd: string): Promise<GitInfo> {
  const empty: GitInfo = { isRepo: false, branch: '', dirtyCount: 0, branches: [], commits: [] }
  try {
    await git(cwd, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    return empty
  }
  try {
    const [branch, status, branchesRaw, logRaw] = await Promise.all([
      git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).then((s) => s.trim()),
      git(cwd, ['status', '--porcelain']),
      git(cwd, ['branch', '--format=%(HEAD)%(refname:short)']),
      git(cwd, [
        'log',
        '--all',
        '--topo-order',
        '-n',
        '100',
        `--pretty=format:%H${SEP}%P${SEP}%an${SEP}%ar${SEP}%D${SEP}%s`
      ])
    ])

    const branches = branchesRaw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => ({ name: l.replace(/^\*/, ''), current: l.startsWith('*') }))

    const commits = layoutLanes(
      logRaw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [hash, parents, author, date, refs, subject] = line.split(SEP)
          return {
            hash,
            parents: (parents ?? '').split(' ').filter(Boolean),
            author: author ?? '',
            date: date ?? '',
            refs: (refs ?? '')
              .split(',')
              .map((r) => r.trim().replace(/^HEAD -> /, ''))
              .filter((r) => r && r !== 'HEAD'),
            subject: subject ?? ''
          }
        })
    )

    return {
      isRepo: true,
      branch,
      dirtyCount: status.split('\n').filter(Boolean).length,
      branches,
      commits
    }
  } catch (err) {
    return { ...empty, isRepo: true, error: String(err).slice(0, 300) }
  }
}
