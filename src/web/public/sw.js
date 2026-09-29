/*
 * Service worker del cliente remoto.
 *
 * Cachea el armazón de la app para que abra sin red, y NUNCA respuestas de
 * /api/*: un historial viejo mostrado como si fuera de ahora es peor que no
 * mostrar nada, porque se aprueban permisos y se envían mensajes sobre lo que
 * se está viendo. Desconectado se dice, no se disimula.
 */

const CACHE = 'deck-web-v1'

const ARMAZON = ['./', './manifest.webmanifest', './icono.svg']

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(ARMAZON.map((u) => new Request(u, { cache: 'reload' }))).catch(() => {})
      /* Los bundles llevan hash en el nombre, que aquí no se conoce: se saca del
         propio HTML para que la app abra sin red ya desde la primera visita. */
      try {
        const res = await fetch('./index.html', { cache: 'reload' })
        await cache.put('./index.html', res.clone())
        const html = await res.text()
        const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1])
        if (assets.length) await cache.addAll(assets)
      } catch {
        /* sin red en la instalación: se cachea al primer uso */
      }
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      await Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (ev) => {
  const req = ev.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  /* El HTML va a la red primero: cachearlo antes que nada dejaría pegada una
     versión vieja del cliente contra un PC ya actualizado. */
  if (req.mode === 'navigate') {
    ev.respondWith(
      (async () => {
        try {
          const res = await fetch(req)
          const cache = await caches.open(CACHE)
          cache.put('./index.html', res.clone())
          return res
        } catch {
          const cache = await caches.open(CACHE)
          return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error()
        }
      })()
    )
    return
  }

  ev.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const guardado = await cache.match(req)
      if (guardado) return guardado
      const res = await fetch(req)
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone())
      return res
    })()
  )
})

/* Aviso empujado por el PC con la app cerrada: es el único camino que no
   depende de que haya alguien mirando ni de que el túnel siga en pie. */
self.addEventListener('push', (ev) => {
  let dato = {}
  try {
    dato = ev.data ? ev.data.json() : {}
  } catch {
    /* un payload ilegible no debe impedir avisar */
  }
  const titulo = dato.titulo || 'Claude Deck'
  const tabId = dato.tabId || ''
  ev.waitUntil(
    self.registration.showNotification(titulo, {
      body: dato.cuerpo || 'Algo requiere tu atención',
      tag: tabId ? `deck-${tabId}` : 'deck',
      icon: './icono.svg',
      badge: './icono.svg',
      data: { ruta: tabId ? `#/chat/${tabId}` : '#/' }
    })
  )
})

/* Al tocar la notificación de un permiso o una pregunta se abre esa
   conversación, no la pantalla de inicio. */
self.addEventListener('notificationclick', (ev) => {
  ev.notification.close()
  const ruta = (ev.notification.data && ev.notification.data.ruta) || '#/'
  ev.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const v of ventanas) {
        if (!v.url.startsWith(self.registration.scope)) continue
        v.postMessage({ tipo: 'ir', ruta })
        if ('focus' in v) await v.focus()
        return
      }
      await self.clients.openWindow('./' + ruta)
    })()
  )
})
