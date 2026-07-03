/* ============================================================
   SERVICE WORKER — web push only. Root scope ("/") so a push
   subscription registered here covers the whole app.

   Intentionally tiny and dependency-free: no offline caching, no asset
   precaching — this file's only job is to show a notification when a push
   arrives and route a click back into the app. Served with a short/no-cache
   Cache-Control (see server.js) so updates propagate on the next visit.
============================================================ */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Fam ETC', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Fam ETC';
  const options = {
    body: data.body || '',
    icon: data.icon,
    badge: data.badge,
    data: data.data || { url: '/' },
  };

  // Show the notification AND immediately nudge any open app tab to refresh,
  // so a chat message renders in the open window with ~no lag instead of
  // waiting for the next poll tick.
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const famType = (data.data && data.data.famType) || null;
      for (const c of clients) c.postMessage({ type: 'fam-push', famType });
    } catch (e) { /* best-effort */ }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        // Focus an existing app tab rather than opening a duplicate one.
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
