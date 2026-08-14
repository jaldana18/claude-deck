import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CiBuild, CiPullRequest, CiRepoInfo } from '../shared/types'
import { callAzureTool } from './mcpBoard'

const run = promisify(execFile)

/**
 * Integración de CI/PRs multi-proveedor. El proveedor se deduce del remote
 * `origin` del repo: GitHub (CLI `gh`), Azure DevOps (MCP azure-devops ya
 * configurado) o Bitbucket Cloud (API REST con app password opcional).
 */

/**
 * Analiza la URL de un remote git y deduce proveedor y coordenadas.
 * Acepta https, ssh (git@host:owner/repo) y las formas de Azure DevOps
 * (dev.azure.com/org/project/_git/repo y org@vs-ssh.visualstudio.com).
 */
export function parseRemote(url: string): CiRepoInfo {
  const raw = url.trim().replace(/\.git$/, '')
  if (!raw) return { provider: 'none' }

  // normaliza ssh scp-like a algo parseable: git@host:path → host/path
  const norm = raw
    .replace(/^git@([^:]+):/, '$1/')
    .replace(/^ssh:\/\/git@/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^[^@/]+@/, '') // usuario embebido en https

  const [host, ...rest] = norm.split('/').filter(Boolean)
  const path = rest

  if (/github\.com$/i.test(host)) {
    const [owner, repo] = path
    return owner && repo ? { provider: 'github', owner, repo } : { provider: 'none' }
  }

  if (/bitbucket\.org$/i.test(host)) {
    const [owner, repo] = path
    return owner && repo ? { provider: 'bitbucket', owner, repo } : { provider: 'none' }
  }

  // Azure DevOps moderno: dev.azure.com/org/project/_git/repo
  if (/dev\.azure\.com$/i.test(host)) {
    const gitIdx = path.indexOf('_git')
    if (gitIdx > 0) {
      return {
        provider: 'azure',
        org: path[0],
        project: path.slice(1, gitIdx).join('/'),
        repo: path[gitIdx + 1]
      }
    }
    return { provider: 'none' }
  }

  // Azure DevOps legado: org.visualstudio.com/project/_git/repo
  if (/\.visualstudio\.com$/i.test(host)) {
    const org = host.split('.')[0]
    const gitIdx = path.indexOf('_git')
    if (gitIdx >= 0) {
      return {
        provider: 'azure',
        org,
        project: path.slice(0, gitIdx).join('/') || undefined,
        repo: path[gitIdx + 1]
      }
    }
    return { provider: 'azure', org }
  }

  return { provider: 'none' }
}

/** Lee el remote origin del repo (vacío si no es repo o no tiene remote) */
export async function detectRepo(cwd: string): Promise<CiRepoInfo> {
  try {
    const { stdout } = await run('git', ['remote', 'get-url', 'origin'], { cwd, windowsHide: true })
    return parseRemote(stdout)
  } catch {
    return { provider: 'none' }
  }
}

/** Normaliza el estado de un build a nuestro vocabulario */
export function normalizeStatus(
  status: string | undefined,
  result?: string | null
): CiBuild['state'] {
  const s = (status ?? '').toLowerCase()
  const r = (result ?? '').toLowerCase()
  if (s === 'inprogress' || s === 'in_progress' || s === 'running' || s === 'queued' || s === 'pending' || s === 'notstarted') {
    return 'running'
  }
  if (r === 'succeeded' || r === 'success' || r === 'successful') return 'success'
  if (r === 'failed' || r === 'failure' || r === 'error') return 'failed'
  if (r === 'canceled' || r === 'cancelled' || r === 'stopped') return 'canceled'
  if (r === 'partiallysucceeded' || r === 'neutral') return 'partial'
  if (s === 'completed') return 'success'
  return 'unknown'
}

function ghJson<T>(cwd: string, args: string[]): Promise<T | null> {
  return run('gh', args, { cwd, windowsHide: true, shell: true, maxBuffer: 4_000_000 })
    .then(({ stdout }) => JSON.parse(stdout) as T)
    .catch(() => null)
}

/** Builds/ejecuciones recientes del repo (máx. 10) */
export async function getBuilds(cwd: string): Promise<{ ok: boolean; repo: CiRepoInfo; builds: CiBuild[]; error?: string }> {
  const repo = await detectRepo(cwd)
  try {
    if (repo.provider === 'github') {
      const rows = await ghJson<
        { databaseId: number; displayTitle: string; workflowName: string; status: string; conclusion: string | null; headBranch: string; createdAt: string; url: string }[]
      >(cwd, ['run', 'list', '--limit', '10', '--json', 'databaseId,displayTitle,workflowName,status,conclusion,headBranch,createdAt,url'])
      if (!rows) {
        return { ok: false, repo, builds: [], error: 'No se pudo consultar GitHub Actions. ¿Está instalado y autenticado el CLI `gh`?' }
      }
      return {
        ok: true,
        repo,
        builds: rows.map((r) => ({
          id: String(r.databaseId),
          name: r.workflowName || r.displayTitle,
          branch: r.headBranch,
          state: normalizeStatus(r.status, r.conclusion),
          finishedAt: r.createdAt,
          url: r.url
        }))
      }
    }

    if (repo.provider === 'azure') {
      if (!repo.project) return { ok: false, repo, builds: [], error: 'No se pudo deducir el proyecto de Azure DevOps del remote.' }
      const res = (await callAzureTool(cwd, 'pipelines_build', {
        action: 'list',
        project: repo.project,
        top: 10,
        queryOrder: 'queueTimeDescending'
      })) as { value?: unknown[] } | unknown[]
      const rows = (Array.isArray(res) ? res : (res?.value ?? [])) as {
        id: number
        buildNumber?: string
        status?: string
        result?: string
        finishTime?: string
        sourceBranch?: string
        definition?: { name?: string }
        _links?: { web?: { href?: string } }
      }[]
      return {
        ok: true,
        repo,
        builds: rows.map((b) => ({
          id: String(b.id),
          name: b.definition?.name ?? b.buildNumber ?? `#${b.id}`,
          branch: (b.sourceBranch ?? '').replace('refs/heads/', ''),
          state: normalizeStatus(b.status, b.result),
          finishedAt: b.finishTime,
          url: b._links?.web?.href
        }))
      }
    }

    if (repo.provider === 'bitbucket') {
      const auth = process.env.BITBUCKET_APP_PASSWORD
      const user = process.env.BITBUCKET_USER
      if (!auth || !user) {
        return {
          ok: false,
          repo,
          builds: [],
          error: 'Configura las variables de entorno BITBUCKET_USER y BITBUCKET_APP_PASSWORD para ver los pipelines.'
        }
      }
      const r = await fetch(
        `https://api.bitbucket.org/2.0/repositories/${repo.owner}/${repo.repo}/pipelines/?sort=-created_on&pagelen=10`,
        { headers: { Authorization: `Basic ${Buffer.from(`${user}:${auth}`).toString('base64')}` } }
      )
      if (!r.ok) return { ok: false, repo, builds: [], error: `Bitbucket respondió HTTP ${r.status}` }
      const data = (await r.json()) as {
        values?: {
          build_number: number
          state?: { name?: string; result?: { name?: string } }
          target?: { ref_name?: string }
          created_on?: string
        }[]
      }
      return {
        ok: true,
        repo,
        builds: (data.values ?? []).map((b) => ({
          id: String(b.build_number),
          name: `Pipeline #${b.build_number}`,
          branch: b.target?.ref_name ?? '',
          state: normalizeStatus(b.state?.name, b.state?.result?.name),
          finishedAt: b.created_on,
          url: `https://bitbucket.org/${repo.owner}/${repo.repo}/pipelines/results/${b.build_number}`
        }))
      }
    }

    return { ok: false, repo, builds: [], error: 'El remote de este repo no es GitHub, Azure DevOps ni Bitbucket.' }
  } catch (err) {
    return { ok: false, repo, builds: [], error: String(err).slice(0, 300) }
  }
}

/** Pull requests abiertos del repo */
export async function getPullRequests(
  cwd: string
): Promise<{ ok: boolean; repo: CiRepoInfo; prs: CiPullRequest[]; error?: string }> {
  const repo = await detectRepo(cwd)
  try {
    if (repo.provider === 'github') {
      const rows = await ghJson<
        { number: number; title: string; author: { login: string }; headRefName: string; isDraft: boolean; url: string; reviewDecision: string | null; statusCheckRollup: { conclusion: string | null }[] | null }[]
      >(cwd, ['pr', 'list', '--limit', '20', '--json', 'number,title,author,headRefName,isDraft,url,reviewDecision,statusCheckRollup'])
      if (!rows) {
        return { ok: false, repo, prs: [], error: 'No se pudo consultar GitHub. ¿Está instalado y autenticado el CLI `gh`?' }
      }
      return {
        ok: true,
        repo,
        prs: rows.map((r) => {
          const checks = r.statusCheckRollup ?? []
          const failed = checks.some((c) => (c.conclusion ?? '').toUpperCase() === 'FAILURE')
          const pending = checks.some((c) => !c.conclusion)
          return {
            id: String(r.number),
            title: r.title,
            author: r.author?.login ?? '',
            branch: r.headRefName,
            draft: r.isDraft,
            reviewState: (r.reviewDecision ?? '').toLowerCase().replace('_', ' ') || undefined,
            checks: failed ? 'failed' : pending ? 'running' : checks.length ? 'success' : 'unknown',
            url: r.url
          }
        })
      }
    }

    if (repo.provider === 'azure') {
      const res = (await callAzureTool(cwd, 'repo_pull_request', {
        action: 'list',
        ...(repo.project ? { project: repo.project } : {}),
        ...(repo.repo ? { repositoryId: repo.repo } : {}),
        status: 'Active',
        top: 20
      })) as { value?: unknown[] } | unknown[]
      const rows = (Array.isArray(res) ? res : (res?.value ?? [])) as {
        pullRequestId: number
        title: string
        createdBy?: { displayName?: string }
        sourceRefName?: string
        isDraft?: boolean
        reviewers?: { vote?: number }[]
      }[]
      return {
        ok: true,
        repo,
        prs: rows.map((pr) => {
          const votes = (pr.reviewers ?? []).map((r) => r.vote ?? 0)
          const reviewState = votes.some((v) => v < 0)
            ? 'cambios pedidos'
            : votes.some((v) => v > 0)
              ? 'aprobado'
              : undefined
          return {
            id: String(pr.pullRequestId),
            title: pr.title,
            author: pr.createdBy?.displayName ?? '',
            branch: (pr.sourceRefName ?? '').replace('refs/heads/', ''),
            draft: Boolean(pr.isDraft),
            reviewState,
            checks: 'unknown' as const,
            url:
              repo.org && repo.project && repo.repo
                ? `https://dev.azure.com/${repo.org}/${encodeURIComponent(repo.project)}/_git/${repo.repo}/pullrequest/${pr.pullRequestId}`
                : undefined
          }
        })
      }
    }

    if (repo.provider === 'bitbucket') {
      const auth = process.env.BITBUCKET_APP_PASSWORD
      const user = process.env.BITBUCKET_USER
      if (!auth || !user) {
        return { ok: false, repo, prs: [], error: 'Configura BITBUCKET_USER y BITBUCKET_APP_PASSWORD para ver los PRs.' }
      }
      const r = await fetch(
        `https://api.bitbucket.org/2.0/repositories/${repo.owner}/${repo.repo}/pullrequests?state=OPEN&pagelen=20`,
        { headers: { Authorization: `Basic ${Buffer.from(`${user}:${auth}`).toString('base64')}` } }
      )
      if (!r.ok) return { ok: false, repo, prs: [], error: `Bitbucket respondió HTTP ${r.status}` }
      const data = (await r.json()) as {
        values?: {
          id: number
          title: string
          author?: { display_name?: string }
          source?: { branch?: { name?: string } }
          links?: { html?: { href?: string } }
        }[]
      }
      return {
        ok: true,
        repo,
        prs: (data.values ?? []).map((pr) => ({
          id: String(pr.id),
          title: pr.title,
          author: pr.author?.display_name ?? '',
          branch: pr.source?.branch?.name ?? '',
          draft: false,
          checks: 'unknown' as const,
          url: pr.links?.html?.href
        }))
      }
    }

    return { ok: false, repo, prs: [], error: 'El remote de este repo no es GitHub, Azure DevOps ni Bitbucket.' }
  } catch (err) {
    return { ok: false, repo, prs: [], error: String(err).slice(0, 300) }
  }
}
