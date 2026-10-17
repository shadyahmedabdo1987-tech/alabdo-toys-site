/* Instant push notifications to the customer app through Firebase Cloud
   Messaging (FCM HTTP v1). Only the messaging service of Firebase is used -
   the store data stays in Cloudflare KV as before.

   Setup (once): Cloudflare Pages -> Settings -> Variables and Secrets ->
   add a SECRET named FCM_SERVICE_ACCOUNT whose value is the whole service
   account JSON file downloaded from Firebase (Project settings -> Service
   accounts -> Generate new private key). Never commit that file.
   Without the secret everything keeps working exactly as before (the app
   still checks for new notifications by itself).

   Device tokens live in KV "pushTokens": [{cid, tail, t, at}] where cid is
   the customer account id (lower case), tail the last 10 digits of it.
   (ASCII-only comments on purpose, same as _lib.js.) */
import { getList, saveList } from "./_lib.js";

var TOKENS_KEY = "pushTokens";
var MAX_PER_CUSTOMER = 5;

function tailOf(p){ return String(p || "").replace(/\D/g, "").slice(-10); }
function b64url(bytes){
  var s = "";
  var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for(var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlText(str){ return b64url(new TextEncoder().encode(str)); }

export function pushConfigured(env){ return !!(env && env.FCM_SERVICE_ACCOUNT); }

function serviceAccount(env){
  try{
    var sa = JSON.parse(env.FCM_SERVICE_ACCOUNT);
    if(sa && sa.client_email && sa.private_key && sa.project_id) return sa;
  }catch(e){}
  return null;
}

async function importKey(pem){
  var body = String(pem).replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\\n/g, "").replace(/\s+/g, "");
  var bin = atob(body), buf = new Uint8Array(bin.length);
  for(var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return crypto.subtle.importKey("pkcs8", buf.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/* OAuth access token for FCM, cached in KV for ~50 minutes */
async function accessToken(env, sa){
  try{
    var cached = JSON.parse(await env.STORE_KV.get("fcm_oauth") || "null");
    if(cached && cached.token && cached.exp > Date.now() + 60000 && cached.who === sa.client_email) return cached.token;
  }catch(e){}
  var now = Math.floor(Date.now() / 1000);
  var head = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  var claims = b64urlText(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600
  }));
  var key = await importKey(sa.private_key);
  var sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + claims));
  var jwt = head + "." + claims + "." + b64url(sig);
  var res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + jwt
  });
  var j = await res.json().catch(function(){ return null; });
  if(!res.ok || !j || !j.access_token) throw new Error("oauth_failed " + res.status);
  try{ await env.STORE_KV.put("fcm_oauth", JSON.stringify({ token: j.access_token, exp: Date.now() + Math.min(3000, +j.expires_in || 3000) * 1000, who: sa.client_email })); }catch(e){}
  return j.access_token;
}

export async function getTokens(env){ return getList(env, TOKENS_KEY); }

function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
/* KV accepts about one write per second on the same key, so when a phone
   switches accounts (remove + register arrive together) the second write
   can fail or overwrite the first. Retry, and remember the latest owner of
   every device in its own small key ("ptr:<hash>") so a late "remove" for
   the old account can never wipe the new registration. */
async function saveTokens(env, list){
  for(var i = 0; i < 4; i++){
    try{ await saveList(env, TOKENS_KEY, list); return true; }
    catch(e){ await sleep(1100); }
  }
  return false;
}
async function tokenKey(token){
  var d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token)));
  return "ptr:" + Array.from(new Uint8Array(d)).slice(0, 16).map(function(b){ return b.toString(16).padStart(2, "0"); }).join("");
}
async function getOwner(env, token){
  try{ return JSON.parse(await env.STORE_KV.get(await tokenKey(token)) || "null"); }catch(e){ return null; }
}
function applyAdd(list, cid, tail, token, at){
  list = list.filter(function(x){ return x && x.t !== token; });
  list.push({ cid: cid, tail: tail, t: token, at: at });
  /* keep the newest few devices per customer */
  var mine = list.filter(function(x){ return x.cid === cid; });
  if(mine.length > MAX_PER_CUSTOMER){
    var drop = mine.slice(0, mine.length - MAX_PER_CUSTOMER).map(function(x){ return x.t; });
    list = list.filter(function(x){ return drop.indexOf(x.t) === -1; });
  }
  if(list.length > 20000) list = list.slice(list.length - 20000);
  return list;
}

export async function addToken(env, customerId, token){
  var cid = String(customerId || "").toLowerCase(), tail = tailOf(customerId), at = Date.now();
  try{ await env.STORE_KV.put(await tokenKey(token), JSON.stringify({ cid: cid, tail: tail, at: at }), { expirationTtl: 60 * 60 * 24 * 400 }); }catch(e){}
  var list = applyAdd(await getTokens(env), cid, tail, token, at);
  await saveTokens(env, list);
  /* a moment later make sure nothing written at the same time removed it */
  await sleep(1500);
  var again = await getTokens(env);
  if(!again.some(function(x){ return x && x.t === token && x.cid === cid; })){
    var own = await getOwner(env, token);
    if(!own || own.cid === cid) await saveTokens(env, applyAdd(again, cid, tail, token, at));
  }
  return list.filter(function(x){ return x.cid === cid; }).length;
}

export async function removeToken(env, customerId, token){
  var cid = String(customerId || "").toLowerCase();
  /* the device already belongs to another account (account switch): the
     new registration moved it, nothing to remove */
  var own = await getOwner(env, token);
  if(cid && own && own.cid && own.cid !== cid) return 0;
  /* the same phone registered this account a few seconds ago: this "remove"
     is a leftover from a re-login, ignore it */
  if(own && own.cid === cid && Date.now() - (+own.at || 0) < 20000) return 0;
  var list = await getTokens(env);
  var next = list.filter(function(x){ return !(x && x.t === token && (!cid || x.cid === cid)); });
  if(next.length === list.length) return 0;
  await saveTokens(env, next);
  /* if the phone registered again for another account meanwhile, put it back */
  await sleep(1500);
  var now = await getOwner(env, token);
  if(now && now.cid && now.cid !== cid){
    var cur = await getTokens(env);
    if(!cur.some(function(x){ return x && x.t === token; })) await saveTokens(env, applyAdd(cur, now.cid, now.tail || "", token, now.at || Date.now()));
  }
  return list.length - next.length;
}

/* small history of device registrations, for the admin card */
export async function logPush(env, ev){
  try{
    var log = JSON.parse(await env.STORE_KV.get("push_log") || "[]");
    if(!Array.isArray(log)) log = [];
    log.push(Object.assign({ at: Date.now() }, ev));
    if(log.length > 30) log = log.slice(log.length - 30);
    await env.STORE_KV.put("push_log", JSON.stringify(log));
  }catch(e){}
}
export async function getPushLog(env){
  try{ var l = JSON.parse(await env.STORE_KV.get("push_log") || "[]"); return Array.isArray(l) ? l : []; }catch(e){ return []; }
}

/* Devices of whoever a note/notification is for (account id or phone) */
export async function tokensFor(env, customerId, phoneTail){
  var cid = String(customerId || "").toLowerCase(), tail = phoneTail ? tailOf(phoneTail) : "";
  return (await getTokens(env)).filter(function(x){
    if(!x || !x.t) return false;
    if(cid && x.cid === cid) return true;
    return !!(tail && tail.length >= 9 && x.tail === tail);
  });
}

/* Send one data message to a list of tokens. data values must be strings.
   Dead tokens (app uninstalled) are removed. Returns {sent, failed}. */
export async function sendPush(env, tokens, data){
  var sa = serviceAccount(env);
  if(!sa || !tokens || !tokens.length) return { sent: 0, failed: 0, configured: !!sa };
  var at;
  try{ at = await accessToken(env, sa); }
  catch(e){
    try{ await env.STORE_KV.put("fcm_last", JSON.stringify({ at: Date.now(), sent: 0, failed: tokens.length, removed: 0, kind: String(data && data.kind || ""), err: "key " + String(e && e.message || e).slice(0, 200) })); }catch(x){}
    throw e;
  }
  var payload = {};
  Object.keys(data || {}).forEach(function(k){ if(data[k] != null) payload[k] = String(data[k]).slice(0, 900); });
  var sent = 0, failed = 0, dead = [], lastErr = "";
  var uniq = [];
  tokens.forEach(function(x){ var t = typeof x === "string" ? x : x.t; if(t && uniq.indexOf(t) === -1) uniq.push(t); });
  await Promise.all(uniq.map(async function(t){
    try{
      var res = await fetch("https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(sa.project_id) + "/messages:send", {
        method: "POST",
        headers: { "authorization": "Bearer " + at, "content-type": "application/json" },
        body: JSON.stringify({ message: { token: t, data: payload, android: { priority: "HIGH", ttl: "172800s" } } })
      });
      if(res.ok){ sent++; return; }
      failed++;
      var txt = await res.text().catch(function(){ return ""; });
      if(!lastErr) lastErr = res.status + " " + txt.replace(/\s+/g, " ").slice(0, 300);
      /* only forget a device when Google says the app is gone from it
         (uninstalled / token expired) - never for other errors */
      if(/UNREGISTERED|registration-token-not-registered|not a valid FCM registration token/i.test(txt)) dead.push(t);
    }catch(e){ failed++; if(!lastErr) lastErr = "net " + String(e && e.message || e).slice(0, 200); }
  }));
  if(dead.length){
    try{
      var list = await getTokens(env);
      var next = list.filter(function(x){ return dead.indexOf(x.t) === -1; });
      if(next.length !== list.length) await saveList(env, TOKENS_KEY, next);
    }catch(e){}
  }
  /* last send result, shown in the admin card (no secrets in it) */
  try{ await env.STORE_KV.put("fcm_last", JSON.stringify({ at: Date.now(), sent: sent, failed: failed, removed: dead.length, kind: String(payload.kind || ""), err: lastErr })); }catch(e){}
  return { sent: sent, failed: failed, removed: dead.length, configured: true, error: lastErr };
}

/* project id of the server key + last send result (for the admin card) */
export async function pushInfo(env){
  var sa = serviceAccount(env), last = null;
  try{ last = JSON.parse(await env.STORE_KV.get("fcm_last") || "null"); }catch(e){}
  return { project: sa ? sa.project_id : "", keyOk: !!sa, last: last };
}

/* Push for a bell note (order status / reply / back in stock) */
export async function pushForNote(env, note){
  if(!pushConfigured(env) || !note) return null;
  var toks = await tokensFor(env, note.customerId, note.phoneTail);
  if(!toks.length) return { sent: 0, failed: 0 };
  var kind = note.type || "inquiry";
  var title, body = note.message || "", link = "home";
  if(kind === "order"){ title = note.title || "تحديث طلبك"; link = "orders"; }
  else if(kind === "stock"){ title = "🎉 رجع متوفر"; if(note.productId && /^\d{1,12}$/.test(String(note.productId))) link = "p:" + note.productId; }
  else { title = "💬 رد على استفسارك"; }
  return sendPush(env, toks, { id: note.id, kind: kind, title: title, body: body || "متجر آل عبده", link: link, at: String(note.at || Date.now()) });
}
