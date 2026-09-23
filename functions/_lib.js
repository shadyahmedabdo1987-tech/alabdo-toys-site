/* Shared helpers for the store's Cloudflare Pages Functions (lightweight
   backend: a single KV namespace bound as STORE_KV holds two keys -
   "products" (the catalog: {categories, products}) and "admin" (the store
   owner's account: {username, passwordHash, recoveryEmail, recoveryPhone}).
   This is deliberately simple (no sessions, no real user system) - it exists
   only so the admin dashboard's changes go live for every visitor immediately,
   instead of needing a manual file re-upload each time. */

export async function sha256Hex(str){
  var enc = new TextEncoder().encode(str);
  var buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(function(b){ return b.toString(16).padStart(2,"0"); }).join("");
}

export function json(obj, status){
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export async function getAdminAccount(env){
  var raw = await env.STORE_KV.get("admin");
  if(!raw) return null;
  try{ return JSON.parse(raw); }catch(e){ return null; }
}

export async function saveAdminAccount(env, acc){
  await env.STORE_KV.put("admin", JSON.stringify(acc));
}

/* Reads admin credentials off custom request headers (never Authorization/
   WWW-Authenticate, so browsers never pop up a native basic-auth dialog) and
   checks them against the stored, hashed account. Used to gate every write.
   (No em dash anywhere in this file - kept ASCII-only to avoid encoding
   issues when the file is created through GitHub's web editor.) */
export async function requireAdmin(request, env){
  var user = request.headers.get("X-Admin-User") || "";
  var pass = request.headers.get("X-Admin-Pass") || "";
  if(!user || !pass) return null;
  var acc = await getAdminAccount(env);
  if(!acc) return null;
  if(acc.username !== user) return null;
  var hash = await sha256Hex(pass);
  if(hash !== acc.passwordHash) return null;
  return acc;
}

function randChar(){
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return chars[Math.floor(Math.random()*chars.length)];
}
export function generatePassword(len){
  len = len || 10;
  var out = "";
  for(var i=0;i<len;i++) out += randChar();
  return out;
}

/* Generic helpers for the extra KV collections added for customer accounts,
   orders and reviews. Each collection is stored as one JSON array under its
   own KV key (same simple approach as "products" and "admin" above). */
export async function getList(env, key){
  var raw = await env.STORE_KV.get(key);
  if(!raw) return [];
  try{
    var v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  }catch(e){ return []; }
}
export async function saveList(env, key, list){
  await env.STORE_KV.put(key, JSON.stringify(list));
}

export async function getCustomers(env){ return getList(env, "customers"); }
export async function saveCustomers(env, list){ return saveList(env, "customers", list); }

function digitsOnly(v){ return String(v || "").replace(/\D/g, ""); }

/* بتربط أي طلبات قديمة اتعملت كضيف (customerId فاضي) برقم موبايل بيطابق
   رقم الحساب، بحساب الحساب ده - عشان لو عميل طلب من غير ما يسجّل وبعدين
   عمل حساب (أو سجّل دخول) بنفس رقم الموبايل، طلباته القديمة تبان له في
   "طلباتي" تلقائي من غير ما يحتاج يعمل أي حاجة زيادة. المطابقة بتقارن
   آخر 9 أرقام بس (بتتجاهل أي فروق زي الأصفار الأولى أو كود الدولة).
   بتتنادى بعد أي تسجيل حساب جديد أو تسجيل دخول ناجح - آمنة تتنادى كذا
   مرة، الطلبات اللي اترابطت قبل كده بتتسيب زي ما هي. */
export async function linkGuestOrdersToCustomer(env, customer){
  var tail = digitsOnly(customer.identifier).slice(-9);
  if(!tail) return;
  var orders = await getList(env, "orders");
  var changed = false;
  orders.forEach(function(o){
    if(o.customerId) return;
    var phoneTail = digitsOnly(o.phone).slice(-9);
    if(phoneTail && phoneTail === tail){
      o.customerId = customer.identifier;
      o.customerName = customer.name;
      changed = true;
    }
  });
  if(changed) await saveList(env, "orders", orders);
}

/* The "products" key holds one object ({categories, products}), not a plain
   array, so it needs its own get/save pair instead of getList/saveList.
   Used by orders.js to auto-decrement stock quantities after an order. */
export async function getCatalog(env){
  var raw = await env.STORE_KV.get("products");
  if(!raw) return null;
  try{
    var v = JSON.parse(raw);
    return (v && Array.isArray(v.products)) ? v : null;
  }catch(e){ return null; }
}
export async function saveCatalog(env, catalog){
  await env.STORE_KV.put("products", JSON.stringify({ categories: catalog.categories||[], products: catalog.products||[] }));
}

/* Reads customer credentials off X-Customer-Id / X-Customer-Pass headers
   (same pattern as requireAdmin above) and checks them against the stored,
   hashed customer account. X-Customer-Id is the customer's phone number
   (their login identifier). */
/* Visitor analytics: one object under KV key "analytics" - {totalViews,
   visitors:[ids], days:{ "YYYY-MM-DD": {views, visitors:[ids], pages:{},
   devices:{mobile,desktop}, events:{addToCart,orderPlaced}} }}. Days older
   than the retention window get pruned (see analytics.js) so the object
   stays a reasonable size even after months of traffic - totalViews and
   visitors keep accumulating forever for the all-time counters. */
export async function getAnalytics(env){
  var raw = await env.STORE_KV.get("analytics");
  if(!raw) return { totalViews:0, visitors:[], days:{} };
  try{
    var v = JSON.parse(raw);
    return {
      totalViews: v.totalViews || 0,
      visitors: Array.isArray(v.visitors) ? v.visitors : [],
      days: (v.days && typeof v.days === "object") ? v.days : {}
    };
  }catch(e){ return { totalViews:0, visitors:[], days:{} }; }
}
export async function saveAnalytics(env, data){
  await env.STORE_KV.put("analytics", JSON.stringify(data));
}

export async function requireCustomer(request, env){
  var id = request.headers.get("X-Customer-Id") || "";
  var pass = request.headers.get("X-Customer-Pass") || "";
  if(!id || !pass) return null;
  var list = await getCustomers(env);
  var acc = list.find(function(c){ return c.identifier.toLowerCase() === id.toLowerCase(); });
  if(!acc) return null;
  var hash = await sha256Hex(pass);
  if(hash !== acc.passwordHash) return null;
  return acc;
}
