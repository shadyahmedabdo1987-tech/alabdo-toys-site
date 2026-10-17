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

export async function addToken(env, customerId, token){
  var cid = String(customerId || "").toLowerCase();
  var list = (await getTokens(env)).filter(function(x){ return x && x.t !== token; });
  list.push({ cid: cid, tail: tailOf(customerId), t: token, at: Date.now() });
  /* keep the newest few devices per customer */
  var mine = list.filter(function(x){ return x.cid === cid; });
  if(mine.length > MAX_PER_CUSTOMER){
    var drop = mine.slice(0, mine.length - MAX_PER_CUSTOMER).map(function(x){ return x.t; });
    list = list.filter(function(x){ return drop.indexOf(x.t) === -1; });
  }
  if(list.length > 20000) list = list.slice(list.length - 20000);
  await saveList(env, TOKENS_KEY, list);
  return mine.length;
}

export async function removeToken(env, customerId, token){
  var cid = String(customerId || "").toLowerCase();
  var list = await getTokens(env);
  var next = list.filter(function(x){ return !(x && x.t === token && (!cid || x.cid === cid)); });
  if(next.length !== list.length) await saveList(env, TOKENS_KEY, next);
  return list.length - next.length;
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
  var at = await accessToken(env, sa);
  var payload = {};
  Object.keys(data || {}).forEach(function(k){ if(data[k] != null) payload[k] = String(data[k]).slice(0, 900); });
  var sent = 0, failed = 0, dead = [];
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
      if(res.status === 404 || /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT/.test(txt)) dead.push(t);
    }catch(e){ failed++; }
  }));
  if(dead.length){
    try{
      var list = await getTokens(env);
      var next = list.filter(function(x){ return dead.indexOf(x.t) === -1; });
      if(next.length !== list.length) await saveList(env, TOKENS_KEY, next);
    }catch(e){}
  }
  return { sent: sent, failed: failed, removed: dead.length, configured: true };
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
