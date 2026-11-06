/* /api/carts - "سلات ما كملتش": العملاء المسجّلين اللي ضافوا منتجات للسلة وما طلبوش.
   - POST (customer headers) {items:[{id,name,qty,price,color,size}], vid}: آخر شكل لسلة
     العميل. سلة فاضية = بتتشال (مثلاً بعد ما يطلب).
   - POST (من غير حساب) {items, vid, contact:{name,phone,governorate,address}}: سلة الزائر
     اللي ما عملش حساب، ومعاها البيانات اللي كتبها في خانات الطلب لو كتب.
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

var VID_RE = /^v[a-z0-9]{6,40}$/i;
var GUEST_MAX = 300, ANON_DAYS = 14;
function prune(map){
  var now = Date.now();
  var guests = Object.keys(map).filter(function(k){ return k.indexOf("g_") === 0; });
  guests.forEach(function(k){ var e = map[k]; if(!e || (!(e.contact && e.contact.phone) && now - (+e.at || 0) > ANON_DAYS * 86400000)) delete map[k]; });
  guests = Object.keys(map).filter(function(k){ return k.indexOf("g_") === 0; }).sort(function(a, b){ return (+map[b].at || 0) - (+map[a].at || 0); });
  guests.slice(GUEST_MAX).forEach(function(k){ delete map[k]; });
}
export async function onRequestPost({ request, env }){
  var acc = await requireCustomer(request, env);
  var b = await body(request);
  var vid = String(b && b.vid || "");
  if(!VID_RE.test(vid)) vid = "";
  if(!acc && !vid) return json({ ok:false, error:"bad_request" }, 400);
  var raw = b && Array.isArray(b.items) ? b.items.slice(0, 40) : [];
  var items = raw.map(function(it){
    return { id: clean(it && it.id, 20), name: clean(it && it.name, 90), qty: Math.max(1, Math.min(999, Math.round(+(it && it.qty) || 1))),
             price: Math.max(0, +(it && it.price) || 0), color: clean(it && it.color, 40), size: clean(it && it.size, 40) };
  }).filter(function(it){ return it.id && it.name; });
  var map = await getMap(env);
  var key = acc ? acc.id : "g_" + vid;
  var changed = false;
  /* العميل سجّل دخول من نفس الجهاز: سلته كضيف بتتشال عشان ما يظهرش مرتين */
  if(acc && vid && map["g_" + vid]){ delete map["g_" + vid]; changed = true; }
  var prev = map[key];
  if(!items.length){
    if(prev){ delete map[key]; changed = true; }
    if(changed) await saveMap(env, map);
    return json({ ok:true, items:0 });
  }
  var c = (!acc && b && b.contact) || {};
  var contact = acc ? null : { name: clean(c.name, 60), phone: clean(c.phone, 20).replace(/[\u0660-\u0669]/g, function(d){ return String(d.charCodeAt(0) - 0x660); }).replace(/[\u06f0-\u06f9]/g, function(d){ return String(d.charCodeAt(0) - 0x6f0); }).replace(/[^\d+]/g, ""), governorate: clean(c.governorate, 40), address: clean(c.address, 140) };
  var sig = JSON.stringify([items, contact]);
  if(prev && prev.sig === sig){ if(changed) await saveMap(env, map); return json({ ok:true, items: items.length, same:true }); }
  var total = items.reduce(function(a, it){ return a + it.qty * it.price; }, 0);
  map[key] = { items: items, total: total, at: Date.now(), sig: sig, contacted: false };
  if(contact){ map[key].guest = true; map[key].contact = contact; map[key].vid = vid; }
  prune(map);
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
    var e = map[id];
    if(!e || !Array.isArray(e.items) || !e.items.length) return;
    if(id.indexOf("g_") === 0){
      /* زائر من غير حساب */
      var ct = e.contact || {}, g10 = tail(ct.phone), gLast = 0;
      if(g10.length >= 9) orders.forEach(function(o){ if(o && tail(o.phone) === g10 && (+o.createdAt || 0) > gLast) gLast = +o.createdAt || 0; });
      if(gLast && gLast >= (+e.at || 0)) return;
      out.push({ id: id, guest: true, name: ct.name || "", phone: ct.phone || "", governorate: ct.governorate || "", address: ct.address || "", items: e.items, total: +e.total || 0, at: +e.at || 0, contacted: !!e.contacted, contactedAt: +e.contactedAt || 0, lastOrderAt: gLast });
      return;
    }
    var c = byId[id];
    if(!c) return;
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
