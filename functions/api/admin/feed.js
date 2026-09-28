import { json, requireAdmin, getAdminAccount, sha256Hex, getList } from "../../_lib.js";

/* Admin app background notifications (new orders / inquiries / "notify me
   when available" requests / newly registered customers).
   The admin app's background check can't hold the admin password, so after
   login the app asks for a separate "notification token" (random, stored on
   the phone only; the server keeps just its hash). The token can ONLY read
   this small feed - it can't change anything. It stops working when the
   admin logs out (revoke) or changes the password.
   POST /api/admin/feed  (X-Admin-User / X-Admin-Pass)
        {action:"token"}          -> {ok, token}
        {action:"revoke", token}  -> {ok}
   GET  /api/admin/feed  (X-Notify-Token) -> latest 15 of each list, only
        the fields a notification needs.
   (ASCII-only comments on purpose, same as _lib.js.) */

function randomHex(n){
  var a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a).map(function(b){ return b.toString(16).padStart(2, "0"); }).join("");
}
async function getTokens(env){
  var raw = await env.STORE_KV.get("notify_tokens");
  try{ var v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; }catch(e){ return []; }
}

export async function onRequestPost({ request, env }){
  var acc = await requireAdmin(request, env);
  if(!acc) return json({ ok:false, error:"unauthorized" }, 401);
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var list = await getTokens(env);
  if(body && body.action === "token"){
    var token = randomHex(24);
    list.push({ hash: await sha256Hex(token), pw: String(acc.passwordHash || "").slice(0, 16), createdAt: Date.now() });
    list = list.slice(-5);
    await env.STORE_KV.put("notify_tokens", JSON.stringify(list));
    return json({ ok:true, token: token });
  }
  if(body && body.action === "revoke" && body.token){
    var h = await sha256Hex(String(body.token));
    list = list.filter(function(t){ return t.hash !== h; });
    await env.STORE_KV.put("notify_tokens", JSON.stringify(list));
    return json({ ok:true });
  }
  return json({ ok:false, error:"bad_request" }, 400);
}

export async function onRequestGet({ request, env }){
  var token = request.headers.get("X-Notify-Token") || "";
  if(!token) return json({ ok:false, error:"unauthorized" }, 401);
  var h = await sha256Hex(token);
  var list = await getTokens(env);
  var rec = list.find(function(t){ return t.hash === h; });
  var acc = await getAdminAccount(env);
  if(!rec || !acc || rec.pw !== String(acc.passwordHash || "").slice(0, 16)) return json({ ok:false, error:"unauthorized" }, 401);

  var orders = (await getList(env, "orders")).slice(-15).map(function(o){
    var qty = 0;
    (Array.isArray(o.items) ? o.items : []).forEach(function(it){ qty += (+it.qty || 0); });
    return { id: o.id, name: o.customerName || o.name || "", total: +o.total || 0, qty: qty, createdAt: o.createdAt || 0 };
  });
  var inquiries = (await getList(env, "inquiries")).slice(-15).map(function(q){
    return { id: q.id, name: q.name || "", message: String(q.message || "").slice(0, 120), createdAt: q.createdAt || 0 };
  });
  var stockRequests = (await getList(env, "stockRequests")).slice(-15).map(function(r){
    return { id: r.id, productName: r.productName || "", colorName: r.colorName || null, sizeLabel: r.sizeLabel || null, name: r.name || "", createdAt: r.createdAt || 0 };
  });
  var customers = (await getList(env, "customers")).slice(-15).map(function(c){
    return { id: c.id || c.identifier || "", name: c.name || "", governorate: c.governorate || "" };
  });
  return json({ ok:true, orders: orders, inquiries: inquiries, stockRequests: stockRequests, customers: customers });
}
