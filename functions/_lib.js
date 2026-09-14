/* Shared helpers for متجر آل عبده's Cloudflare Pages Functions (lightweight
   backend: a single KV namespace bound as STORE_KV holds two keys —
   "products" (the catalog: {categories, products}) and "admin" (the store
   owner's account: {username, passwordHash, recoveryEmail, recoveryPhone}).
   This is deliberately simple (no sessions, no real user system) — it exists
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
   checks them against the stored, hashed account. Used to gate every write. */
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
