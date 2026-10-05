/* متجر آل عبده — service worker:
   - صفحة الموقع (index.html): بنحاول نجيبها من النت، ولو النت أبطأ من
     ثانية ونص (أو قاطع) بنفتح آخر نسخة محفوظة على طول وبنحدّثها في الخلفية -
     عشان الموقع والتطبيق يفتحوا بسرعة حتى على نت ضعيف. أي تحديث للموقع
     بيوصل فورًا لو النت كويس، أو من الفتحة اللي بعدها لو النت بطيء.
   - صور المنتجات (/api/img): من النسخة المحفوظة على طول (الصورة مبتتغيرش).
   - الصور والأيقونات: من النسخة المحفوظة الأول (أسرع)، وبتتحدث في الخلفية.
   - قائمة المنتجات (/api/products): بتظهر فورًا من آخر نسخة محفوظة على
     الجهاز، وبتتحدث من السيرفر في الخلفية للمرة الجاية - عشان التطبيق يفتح
     بسرعة حتى لو القائمة كبيرة أو النت ضعيف.
   - لوحة التحكم بتطلب /api/products?fresh=1، وده بيعدّي على السيرفر مباشرة
     دايمًا، عشان التعديل يتعمل على آخر نسخة حقيقية (ومفيش منتج يتمسح).
   - باقي /api/* (الطلبات والحسابات...) وملف التطبيق .apk: من السيرفر دايمًا. */
var CACHE_NAME = "aalabda-store-v7";
var IMG_CACHE = "aalabda-img-v1";
var NAV_TIMEOUT_MS = 1500;
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
        keys.filter(function (k) { return k !== CACHE_NAME && k !== IMG_CACHE; })
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
  /* صور المنتجات: كل لينك صورة ثابت للأبد (اسمه جاي من محتوى الصورة) */
  if (url.pathname === "/api/img") {
    event.respondWith(
      caches.open(IMG_CACHE).then(function (cache) {
        return cache.match(req).then(function (cached) {
          if (cached) return cached;
          return fetch(req).then(function (response) {
            if (response && response.ok) cache.put(req, response.clone());
            return response;
          });
        });
      })
    );
    return;
  }
  if (url.pathname.indexOf("/api/") === 0) return;
  if (/\.apk$/i.test(url.pathname)) return;

  if (req.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match("./index.html").then(function (cached) {
          var servedCached = false;
          var network = fetch(req).then(function (response) {
            if (response && response.ok) {
              cache.put("./index.html", response.clone());
              /* النت كان بطيء فاتفتحت النسخة المحفوظة، والنسخة اللي وصلت من
                 السيرفر أحدث منها: نبلّغ الصفحة عشان تتحدّث لوحدها */
              if (servedCached && cached) {
                var oldTag = cached.headers.get("etag") || cached.headers.get("last-modified") || cached.headers.get("content-length") || "";
                var newTag = response.headers.get("etag") || response.headers.get("last-modified") || response.headers.get("content-length") || "";
                if (oldTag && newTag && oldTag !== newTag) {
                  self.clients.matchAll({ type: "window" }).then(function (list) {
                    list.forEach(function (c) { c.postMessage({ type: "aa-updated" }); });
                  });
                }
              }
            }
            return response;
          });
          if (!cached) return network;
          event.waitUntil(network.catch(function () {}));
          var slow = new Promise(function (resolve) { setTimeout(function () { servedCached = true; resolve(cached); }, NAV_TIMEOUT_MS); });
          return Promise.race([network.catch(function () { return cached; }), slow]);
        });
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
