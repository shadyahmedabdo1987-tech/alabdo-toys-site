/* متجر آل عبده — service worker:
   - صفحة الموقع (index.html): من النت الأول دايمًا، وبس لو النت قاطع بنفتح
     آخر نسخة محفوظة - عشان أي تحديث للموقع يوصل للعملاء فورًا.
   - الصور والأيقونات: من النسخة المحفوظة الأول (أسرع)، وبتتحدث في الخلفية.
   - /api/* (المنتجات والطلبات والحسابات) وملف التطبيق .apk: مبتتحفظش خالص
     ودايمًا من السيرفر مباشرة. (النسخ القديمة كانت بتحفظ /api/products،
     فلوحة التحكم كانت ممكن تقرا نسخة قديمة من المنتجات وتحفظ فوقها، وده
     كان بيمسح منتجات اتضافت قبل كده.) */
var CACHE_NAME = "aalabda-store-v4";
var CORE_ASSETS = [
  "./index.html",
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
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return;
  if (/\.apk$/i.test(url.pathname)) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put("./index.html", copy); });
        }
        return response;
      }).catch(function () {
        return caches.match("./index.html");
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      var networkFetch = fetch(req).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return response;
      }).catch(function () { return cached; });
      return cached || networkFetch;
    })
  );
});
