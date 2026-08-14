/** Utilidades de versión semántica usadas por el auto-updater. */

export function parseVersion(v: string): number[] {
  return v.split('.').map((n) => parseInt(n, 10) || 0)
}

/** >0 si a es mayor que b, <0 si es menor, 0 si son iguales (major.minor.patch) */
export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
  }
  return 0
}
