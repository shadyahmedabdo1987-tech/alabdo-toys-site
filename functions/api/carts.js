/* /api/carts - "سلات ما كملتش": العملاء المسجّلين اللي ضافوا منتجات للسلة وما طلبوش.
   - POST (customer headers) {items:[{id,name,qty,price,color,size}]}: آخر شكل لسلة
     العميل. سلة فاضية = بتتشال (مثلاً بعد ما يطلب).
   - GET  (admin): كل السلات اللي فيها منتجات ومفيش طلب بعدها، بالاسم والموبايل.
   - PATCH (admin) {id, contacted:true|false}: علّم إنك كلمته.
   - DELETE (admin) {id}: شيل السلة من القائمة.
   (ASCII-only logic, Arabic comments only.) */
import { json, requireAdmin, requireCustomer, getList, getCustomers } from "../_lib.js";

var KEY = "abandonedCarts";

async function getMap(env){
  try{
    var v = JSON.parse(await env.STORE_KV.get(KEY) || "{}");
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  }catch(e){ return {}; }
}
async function saveMap(env, map){ await env.STORE_KV.put(KEY, JSON.stringify(map)); }
function clean(s, n){ return String(s == null ? "" : s).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n); }
function tail(v){ return String(v || "").replace(/\D/g, "").slice(-10); }
async function body(request){ try{ return await request.json(); }catch(e){ return null; } }

export async function onRequestPost({ request, env }){
  var acc = await requireCustomer(request, env);
  if(!acc) return json({ ok:false, error:"unauthorized" }, 401);
  var b = await body(request);
  var raw = b && Array.isArray(b.items) ? b.items.slice(0, 40) : [];
  var items = raw.map(function(it){
    return { id: clean(it && it.id, 20), name: clean(it && it.name, 90), qty: Math.max(1, Math.min(999, Math.round(+(it && it.qty) || 1))),
             price: Math.max(0, +(it && it.price) || 0), color: clean(it && it.color, 40), size: clean(it && it.size, 40) };
  }).filter(function(it){ return it.id && it.name; });
  var map = await getMap(env);
  var prev = map[acc.id];
  if(!items.length){
    if(prev){ delete map[acc.id]; await saveMap(env, map); }
    return json({ ok:true, items:0 });
  }
  var sig = JSON.stringify(items);
  if(prev && prev.sig === sig) return json({ ok:true, items: items.length, same:true });
  var total = items.reduce(function(a, it){ return a + it.qty * it.price; }, 0);
  map[acc.id] = { items: items, total: total, at: Date.now(), sig: sig, contacted: false };
  await saveMap(env, map);
  return json({ ok:true, items: items.length });
}

export async function onRequestGet({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var map = await getMap(env);
  var customers = await getCustomers(env);
  var orders = await getList(env, "orders");
  var byId = {};
  customers.forEach(function(c){ if(c && c.id) byId[c.id] = c; });
  var out = [];
  Object.keys(map).forEach(function(id){
    var e = map[id], c = byId[id];
    if(!e || !c || !Array.isArray(e.items) || !e.items.length) return;
    var cid = String(c.identifier || "").toLowerCase(), t10 = tail(c.identifier);
    var lastOrder = 0;
    orders.forEach(function(o){
      if(!o) return;
      var mine = (o.customerId && String(o.customerId).toLowerCase() === cid) || (t10.length >= 9 && tail(o.phone) === t10);
      if(mine && (+o.createdAt || 0) > lastOrder) lastOrder = +o.createdAt || 0;
    });
    if(lastOrder && lastOrder >= (+e.at || 0)) return; /* طلب بعد آخر تعديل في السلة = مش سلة متروكة */
    out.push({ id: id, name: c.name || "", phone: c.identifier || "", governorate: c.governorate || "", items: e.items, total: +e.total || 0, at: +e.at || 0, contacted: !!e.contacted, contactedAt: +e.contactedAt || 0, lastOrderAt: lastOrder });
  });
  out.sort(function(a, b){ return b.at - a.at; });
  return json({ ok:true, carts: out, now: Date.now() });
}

export async function onRequestPatch({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var b = await body(request);
  var id = String(b && b.id || "");
  var map = await getMap(env);
  if(!map[id]) return json({ ok:false, error:"not_found" }, 404);
  map[id].contacted = !!(b && b.contacted);
  map[id].contactedAt = map[id].contacted ? Date.now() : 0;
  await saveMap(env, map);
  return json({ ok:true });
}

export async function onRequestDelete({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var b = await body(request);
  var id = String(b && b.id || "");
  var map = await getMap(env);
  if(!map[id]) return json({ ok:false, error:"not_found" }, 404);
  delete map[id];
  await saveMap(env, map);
  return json({ ok:true });
}
