/* Where each customer signed up and what they use (site / Android app /
   iPhone app). Kept in its own KV key ("custVia"), keyed by customer id,
   so it never touches the customers list itself.
   { "<cus_id>": { s:"android"|"ios"|"web", sd:"iphone"|"android"|"pc", sAt:ms,
                   android:ms, ios:ms, web:ms, wd:"iphone"|"android"|"pc" } }
   (ASCII-only comments on purpose, same as _lib.js.) */
var KEY = "custVia";
var THROTTLE = 3 * 60 * 60 * 1000;

export function viaOf(request){
  var ua = String(request.headers.get("User-Agent") || "");
  if(/AlAbdoApp\//.test(ua)) return /iOS|iPhone|iPad|iPod/.test(ua) ? "ios" : "android";
  var h = String(request.headers.get("X-AA-Via") || "").toLowerCase();
  if(h === "ios" || h === "android") return h;
  return "web";
}
function webDev(request){
  var ua = String(request.headers.get("User-Agent") || "");
  if(/iPhone|iPad|iPod/.test(ua)) return "iphone";
  if(/Android/.test(ua)) return "android";
  return "pc";
}
export async function getViaMap(env){
  try{
    var raw = await env.STORE_KV.get(KEY);
    var v = raw ? JSON.parse(raw) : {};
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  }catch(e){ return {}; }
}
/* signup=true on registration: records where the account was created */
export async function markVia(env, cusId, request, signup){
  if(!cusId) return;
  try{
    var map = await getViaMap(env);
    var e = map[cusId] || {};
    var via = viaOf(request), now = Date.now();
    if(!signup && e[via] && now - (+e[via] || 0) < THROTTLE) return;
    if(signup){ e.s = via; e.sAt = now; if(via === "web") e.sd = webDev(request); }
    e[via] = now;
    if(via === "web") e.wd = webDev(request);
    map[cusId] = e;
    await env.STORE_KV.put(KEY, JSON.stringify(map));
  }catch(e2){ /* never blocks the request */ }
}
export async function dropVia(env, cusId){
  try{
    var map = await getViaMap(env);
    if(map[cusId]){ delete map[cusId]; await env.STORE_KV.put(KEY, JSON.stringify(map)); }
  }catch(e){}
}
