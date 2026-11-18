// Forka's service worker does one thing: receive what Android shares into the installed
// app (the manifest's share_target posts to /app/share-target). It keeps the shared link,
// text and photos in a cache for a moment and opens the app, which picks them up
// (src/lib/incomingShare.ts). Every other request goes to the network as usual: nothing is
// cached for offline use, and nothing is sent anywhere.

const SHARE_CACHE = 'forka-share-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/app/share-target') return;
  event.respondWith((async () => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    try {
      const form = await event.request.formData();
      const cache = await caches.open(SHARE_CACHE);
      const files = form.getAll('photos').filter(f => f && typeof f === 'object' && 'size' in f && f.size > 0).slice(0, 6);
      const meta = { title: String(form.get('title') || ''), text: String(form.get('text') || ''), url: String(form.get('url') || ''), files: files.map((f, i) => ({ key: `/share/${id}/${i}`, name: f.name || `photo-${i + 1}.jpg`, type: f.type || 'image/jpeg' })) };
      await Promise.all(files.map((f, i) => cache.put(meta.files[i].key, new Response(f, { headers: { 'Content-Type': meta.files[i].type } }))));
      await cache.put(`/share/${id}/meta`, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
    } catch {
      return Response.redirect('/app/?share=failed', 303);
    }
    return Response.redirect(`/app/?share=${id}`, 303);
  })());
});
