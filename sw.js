const CACHE = 'pt-v3';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// El HTML (la página en sí) siempre se pide primero a la red, para que una
// actualización publicada se vea de inmediato — el caché queda solo como
// respaldo para cuando no hay conexión.
//
// ESTE ERA EL BUG DE FONDO detrás de "el balance de Hoy no se mueve aunque
// guarde comida/ejercicio/calorías": las llamadas a la API de Supabase
// (knpwdpotzugxliygaglw.supabase.co/rest/v1/...) NO son de tipo "navigate"
// ni piden "text/html", así que antes caían en la rama de abajo —
// "cache-first" — igual que el ícono o el manifest. La PRIMERA vez que la
// app pedía, por ejemplo, las calorías quemadas de hoy, esa respuesta
// quedaba guardada en el caché del Service Worker bajo esa URL exacta.
// Cualquier guardado posterior (nueva comida, un ejercicio marcado,
// calorías quemadas) sí llegaba a Supabase — por eso el guardado "funciona"
// — pero la próxima vez que la app pedía esos mismos datos para pintar el
// balance, el Service Worker devolvía esa respuesta vieja del caché sin
// siquiera preguntarle a la red. Por eso el número nunca cambiaba: no
// importaba qué se guardara, la pantalla seguía mostrando la primera
// respuesta que quedó cacheada. Esto pasa por navegador/dispositivo por
// separado, lo cual también explica por qué un cambio hecho en la
// computadora no se veía igual en el celular.
//
// La solución: cualquier pedido a un origen distinto al de la app (o sea,
// la API de Supabase) va siempre a la red primero, nunca al caché. Solo
// los archivos propios de la app que casi nunca cambian (ícono, manifest)
// se siguen sirviendo del caché primero.
self.addEventListener('fetch', e => {
  const reqUrl = new URL(e.request.url);
  const isHtml = e.request.mode === 'navigate' ||
    (e.request.method === 'GET' && (e.request.headers.get('accept') || '').includes('text/html'));
  const isCrossOrigin = reqUrl.origin !== self.location.origin;

  if (isHtml || isCrossOrigin) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Solo el HTML de la app se guarda como respaldo offline — las
          // respuestas de la API cambian todo el tiempo y no deben quedar
          // fijas en el caché ni un instante.
          if (isHtml) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => {
          if (isHtml) return caches.match(e.request).then(cached => cached || caches.match('/index.html'));
          // Sin conexión y era una llamada a la API: no hay nada útil que
          // devolver del caché (sería un dato viejo haciéndose pasar por
          // actual), así que se deja fallar la petición tal cual.
          throw new Error('offline');
        })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('/index.html')))
  );
});
