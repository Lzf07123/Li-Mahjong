/*
 * 雀记 Service Worker:离线壳缓存(仅生产环境注册,见 src/main.tsx;开发热更新不受影响)
 * 策略:
 *   - 页面导航:网络优先,断网回退缓存的 index.html → 弱网/断网不再白屏
 *   - /assets/*(内容哈希产物)与其余静态文件(图标/manifest):缓存优先,未命中才回源
 *   - /api 与 /socket.io:一律直连,绝不缓存
 * 发布新版本时,若需强制刷新非哈希资源(图标/manifest),把 VERSION +1 即可。
 */
const VERSION = 'v1';
const CACHE = `queji-shell-${VERSION}`;

// 安装:预缓存应用壳(index.html + manifest + 图标),立即接管旧 Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled([
        cache.add('/index.html'),
        cache.add('/manifest.webmanifest'),
        cache.add('/icons/favicon-32.png'),
        cache.add('/icons/icon-192.png'),
        cache.add('/icons/apple-touch-icon.png'),
      ]);
      await self.skipWaiting();
    })(),
  );
});

// 激活:清掉旧版本缓存(应用为单 bundle,页面持有旧资源只发生在重载前,重载必走网络优先,可安全清理)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('queji-shell-') && n !== CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  if (request.mode === 'navigate') {
    // 导航:网络优先,成功即刷新壳缓存;失败回退离线壳
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put('/index.html', fresh.clone());
          return fresh;
        } catch {
          return (await caches.match('/index.html')) || (await caches.match(request)) || Response.error();
        }
      })(),
    );
    return;
  }

  // 静态资源:缓存优先,未命中回源并写入缓存
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const fresh = await fetch(request);
      if (fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone());
      }
      return fresh;
    })(),
  );
});
