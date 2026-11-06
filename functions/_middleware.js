/* فصل الموقع: العملاء على https://alabdo-toys.com/ والإدارة على https://alabdo-toys.com/admin
   - صفحة العملاء (/) بتتبعت من غير أي شاشة أو كلام خاص بالإدارة: كل محتوى لوحة
     التحكم بيتشال منها قبل ما توصل لموبايل العميل (بيفضل بس هيكل فاضي من غير كلام
     عشان كود الصفحة ما يقعش).
   - صفحة الإدارة (/admin) بتتبعت كاملة، ومش بتظهر في جوجل.
   - تطبيق الإدارة القديم بيفتح /?source=admin فبيتحوّل لوحده على /admin.
   (ASCII-safe: any error here falls back to the normal page, the site never breaks.) */
const ADMIN_PATH = "/admin";
const TEXT_ATTRS = ["placeholder", "title", "aria-label", "alt", "data-confirm"];

function isAdminRequest(url, request){
  const ua = request.headers.get("User-Agent") || "";
  return url.searchParams.get("source") === "admin" || /AlAbdoAdmin\//.test(ua);
}

function customerPage(res){
  const out = new HTMLRewriter()
    .on("#view-admin, #view-admin *", {
      element(el){ TEXT_ATTRS.forEach(function(a){ if(el.hasAttribute(a)) el.removeAttribute(a); }); },
      text(t){ t.remove(); }
    })
    .transform(res);
  const r = new Response(out.body, out);
  r.headers.set("X-AA-Page", "customer");
  return r;
}

export async function onRequest(ctx){
  const { request, env, next } = ctx;
  if(request.method !== "GET" && request.method !== "HEAD") return next();
  let url;
  try{ url = new URL(request.url); }catch(e){ return next(); }
  const p = url.pathname;
  try{
    if(p === ADMIN_PATH || p === ADMIN_PATH + "/"){
      const a = await env.ASSETS.fetch(new Request(new URL("/", url).toString(), { headers: request.headers }));
      const r = new Response(a.body, a);
      r.headers.set("Cache-Control", "no-store");
      r.headers.set("X-Robots-Tag", "noindex, nofollow");
      r.headers.set("X-AA-Page", "admin");
      return r;
    }
    if(p === "/" || p === "/index.html"){
      if(isAdminRequest(url, request)){
        return Response.redirect(new URL(ADMIN_PATH + url.search + url.hash, url).toString(), 302);
      }
      const res = await next();
      const ct = res.headers.get("content-type") || "";
      if(res.status !== 200 || ct.indexOf("text/html") === -1) return res;
      return customerPage(res);
    }
  }catch(e){ /* fall through to the normal response */ }
  return next();
}
