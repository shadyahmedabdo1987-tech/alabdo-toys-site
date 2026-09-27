/* متجر آل عبده — service worker:
   - صفحة الموقع (index.html): من النت الأول دايمًا، وبس لو النت قاطع بنفتح
     آخر نسخة محفوظة - عشان أي تحديث للموقع يوصل للعملاء فورًا.
   - الصور والأيقونات: من النسخة المحفوظة الأول (أسرع)، وبتتحدث في الخلفية.
   - قائمة المنتجات (/api/products): بتظهر فورًا من آخر نسخة محفوظة على
     الجهاز، وبتتحدث من السيرفر في الخلفية للمرة الجاية - عشان التطبيق يفتح
     بسرعة حتى لو القائمة كبيرة أو النت ضعيف.
   - لوحة التحكم بتطلب /api/products?fresh=1، وده بيعدّي على السيرفر مباشرة
     دايمًا، عشان التعديل يتعمل على آخر نسخة حقيقية (ومفيش منتج يتمسح).
   - باقي /api/* (الطلبات والحسابات...) وملف التطبيق .apk: من السيرفر دايمًا. */
var CACHE_NAME = "aalabda-store-v5";
var CATALOG_KEY = "/api/products";
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
  if (url.pathname === "/api/products" && !url.searchParams.has("fresh")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(CATALOG_KEY).then(function (cached) {
          var network = fetch(req).then(function (response) {
            if (response && response.ok) cache.put(CATALOG_KEY, response.clone());
            return response;
          });
          if (cached) {
            event.waitUntil(network.catch(function () {}));
            return cached;
          }
          return network;
        });
      })
    );
    return;
  }
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
