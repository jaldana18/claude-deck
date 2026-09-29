/**
 * La invitación que trae la URL y si estamos dentro de la app instalada. Son las
 * dos decisiones del arranque, y las dos se equivocan en silencio: por eso viven
 * aparte y con pruebas.
 */

/**
 * El código viaja en el fragmento: el navegador no lo manda al servidor, así que
 * no queda en los registros del PC ni en los del túnel.
 */
const PATRON = /(?:^#|[#&?])c=([A-Za-z0-9]{4,16})/

/** Si la dirección trae un código, haya o no que usarlo: la barra se limpia igual. */
export function hayCodigo(hash: string): boolean {
  return PATRON.test(hash)
}

/**
 * El código con el que emparejar al arrancar, o null si no hay que emparejar.
 *
 * Un dispositivo ya vinculado no lo usa: el código es de un solo uso, y pedirlo
 * otra vez a quien ya tiene su llave solo consigue gastarlo y dejar al siguiente
 * dispositivo sin poder entrar.
 */
export function invitacion(hash: string, yaVinculado: boolean): string | null {
  if (yaVinculado) return null
  const m = PATRON.exec(hash)
  return m ? m[1].toUpperCase() : null
}

/**
 * Si esto corre dentro de la app instalada y no en una pestaña del navegador.
 *
 * Importa porque en iPhone la app añadida a la pantalla de inicio tiene su propio
 * almacén: vincular en el navegador no vincula la app, y el código se pediría
 * otra vez. La pantalla de emparejamiento avisa cuando esto es false.
 */
export function instalada(): boolean {
  const iOS = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iOS || window.matchMedia('(display-mode: standalone)').matches
}
