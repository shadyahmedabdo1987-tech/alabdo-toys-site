/* متجر آل عبده — service worker بسيط:
   بيخزن نسخة من صفحة الموقع والأيقونات عشان لو النت ضعيف أو قطع لحظي،
   التطبيق يفتح برضه بدل ما يبيّض.

   مهم: الصفحة الرئيسية (index.html) وأي طلب لـ /api/ لازم يتجابوا من
   السيرفر أولاً (network-first) مش من الكاش، عشان أي تحديث (منتجات،
   طلبات، تصميم) يظهر فورًا من غير ما المستخدم يعلق على نسخة قديمة
   متخزنة. الكاش هنا بس شبكة أمان لو النت اتقطع فعلاً. */
var CACHE_NAME = "aalabda-store-v2";
var CORE_ASSETS = [
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE_ASSETS);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  var url = new URL(event.request.url);

  /* بيانات حية (منتجات/طلبات/تقييمات/حسابات) — من السيرفر دايمًا، من غير أي تخزين مؤقت. */
  if (url.pathname.indexOf("/api/") === 0) {
    event.respondWith(fetch(event.request));
    return;
  }

  /* صفحة الموقع نفسها وأي تنقل (hash routing) — نجرب السيرفر أولاً عشان
     أي تحديث يظهر فورًا، ولو النت مقطوع نرجع لآخر نسخة متخزنة كحل بديل. */
  if (event.request.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname === "/" ) {
    event.respondWith(
      fetch(event.request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      }).catch(function () { return caches.match(event.request); })
    );
    return;
  }

  /* باقي الملفات الثابتة (أيقونات، manifest) — كاش أولاً، وتحديث في الخلفية. */
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var networkFetch = fetch(event.request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      }).catch(function () { return cached; });
      return cached || networkFetch;
    })
  );
});
