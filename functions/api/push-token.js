/* /api/push-token - device registration for instant push (Firebase Cloud
   Messaging). The customer app sends its FCM token here after the customer
   logs in, so order-status updates and replies reach the phone in seconds.
   - POST   (customer headers) {token}  -> save this device for the account
   - POST   (customer headers) {token, action:"remove"} or DELETE {token}
                                        -> forget it (logout)
   - GET    ?status=1 (admin)           -> {configured, devices, customers,
                                           people:[{id,name,devices,at}],
                                           project, last send result}
   - PUT    (admin) {phone}             -> send a test notification to that
                                           customer's devices
   (ASCII-only comments on purpose, same as _lib.js.) */
import { json, requireAdmin, requireCustomer, getList } from "../_lib.js";
import { addToken, removeToken, getTokens, tokensFor, sendPush, pushConfigured, pushInfo } from "../_push.js";

var TOKEN_RE = /^[\w:\-.]{20,4096}$/;

async function bodyOf(request){ try{ return await request.json(); }catch(e){ return null; } }

export async function onRequestPost({ request, env }){
  var acc = await requireCustomer(request, env);
  if(!acc) return json({ ok:false, error:"unauthorized" }, 401);
  var b = await bodyOf(request);
  var token = String(b && b.token || "");
  if(!TOKEN_RE.test(token)) return json({ ok:false, error:"bad_token" }, 400);
  /* logout from the app: {token, action:"remove"} (POST, because some phones
     can't send a body with DELETE) */
  if(b && b.action === "remove"){
    var gone = await removeToken(env, acc.identifier, token);
    return json({ ok:true, removed: gone });
  }
  var n = await addToken(env, acc.identifier, token);
  return json({ ok:true, devices: n, configured: pushConfigured(env) });
}

export async function onRequestDelete({ request, env }){
  var acc = await requireCustomer(request, env);
  if(!acc) return json({ ok:false, error:"unauthorized" }, 401);
  var b = await bodyOf(request);
  var token = String(b && b.token || "");
  if(!TOKEN_RE.test(token)) return json({ ok:false, error:"bad_token" }, 400);
  var removed = await removeToken(env, acc.identifier, token);
  return json({ ok:true, removed: removed });
}

export async function onRequestGet({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var list = await getTokens(env), by = {};
  list.forEach(function(x){
    if(!x || !x.cid) return;
    var e = by[x.cid] || (by[x.cid] = { id: x.cid, devices: 0, at: 0 });
    e.devices++; if((+x.at || 0) > e.at) e.at = +x.at || 0;
  });
  /* names of the customers whose phones are registered */
  var names = {};
  try{ (await getList(env, "customers")).forEach(function(c){ if(c && c.identifier) names[String(c.identifier).toLowerCase()] = c.name || ""; }); }catch(e){}
  var people = Object.keys(by).map(function(k){ var e = by[k]; e.name = names[k] || ""; return e; })
    .sort(function(a, b){ return b.at - a.at; }).slice(0, 50);
  var info = await pushInfo(env);
  return json({ ok:true, configured: pushConfigured(env), devices: list.length, customers: people.length, people: people, project: info.project, keyOk: info.keyOk, last: info.last });
}

export async function onRequestPut({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  if(!pushConfigured(env)) return json({ ok:false, error:"not_configured" }, 409);
  var b = await bodyOf(request);
  var phone = String(b && b.phone || "").trim();
  if(phone.replace(/\D/g, "").length < 9) return json({ ok:false, error:"bad_phone" }, 400);
  var toks = await tokensFor(env, phone, phone);
  if(!toks.length) return json({ ok:false, error:"no_devices" }, 404);
  try{
    var r = await sendPush(env, toks, { id: "test_" + Date.now().toString(36), kind: "order", title: "🔔 تجربة إشعارات متجر آل عبده", body: "لو الرسالة دي ظهرت فوق الشاشة يبقى الإشعارات الفورية شغالة ✅", link: "orders", at: String(Date.now()) });
    return json({ ok: r.sent > 0, sent: r.sent, failed: r.failed, removed: r.removed, devices: toks.length, detail: r.error || "" });
  }catch(e){
    return json({ ok:false, error:"send_failed", detail: String(e && e.message || e).slice(0, 200) }, 502);
  }
}
