import { json, requireAdmin, requireCustomer } from "../_lib.js";
import { getCoupons, saveCoupons, findCoupon, couponState, usedBy, useCount, perCustomerLimit, normCode, COUPON_DAYS } from "../_coupons.js";

/* Discount codes.
   GET  /api/coupons                         admin: every code + who used it
   POST /api/coupons {action:"create", percent, prefix, note}   admin: new code
                                              PREFIX-XXXXXX (valid 30 days)
        perCustomer: 1,2,3... times per customer, 0 = no limit
        {action:"limit", code, perCustomer}              admin: change that limit
        {action:"toggle", code}                          admin: stop / resume a code
        {action:"delete", code}                          admin: delete a code
        {action:"check", code, phone}         logged-in customer: is the code
                                              valid for me? -> {ok, code, percent, expiresAt}
   (ASCII-only comments on purpose, same as _lib.js.) */

var ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; /* no 0/O/1/I - easy to read & type */
/* prefix = the first part of the code, chosen by the admin (e.g. VIP, EID,
   FB) so a code can be aimed at a group of customers. English letters and
   digits only (customers type it), 2-12 chars; anything else -> ABDO. */
/* 0 = no limit, otherwise 1..100 uses per customer (default 1) */
function cleanLimit(v){
  if(v === 0 || v === "0") return 0;
  var n = Math.round(+v);
  return n >= 1 ? Math.min(n, 100) : 1;
}
function cleanPrefix(p){
  var c = String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return c.length >= 2 ? c : "ABDO";
}
function randomCode(prefix){
  var a = new Uint8Array(6);
  crypto.getRandomValues(a);
  var s = "";
  for(var i = 0; i < a.length; i++) s += ALPHA[a[i] % ALPHA.length];
  return cleanPrefix(prefix) + "-" + s;
}

export async function onRequestGet({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var list = await getCoupons(env);
  return json({ ok:true, coupons: list, now: Date.now() });
}

export async function onRequestPost({ request, env }){
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var action = body && body.action;

  if(action === "check"){
    var customer = await requireCustomer(request, env);
    if(!customer) return json({ ok:false, error:"login_required" }, 401);
    var list0 = await getCoupons(env);
    var c0 = findCoupon(list0, body.code);
    var st = couponState(c0);
    if(st !== "ok") return json({ ok:false, error: st }, 404);
    if(usedBy(c0, customer, body.phone)) return json({ ok:false, error:"used", limit: perCustomerLimit(c0) }, 409);
    var lim0 = perCustomerLimit(c0);
    return json({ ok:true, code: c0.code, percent: c0.percent, expiresAt: c0.expiresAt,
      perCustomer: lim0, left: lim0 ? Math.max(0, lim0 - useCount(c0, customer, body.phone)) : null });
  }

  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var list = await getCoupons(env);

  if(action === "create"){
    var percent = Math.round(+body.percent);
    if(!(percent >= 1 && percent <= 90)) return json({ ok:false, error:"bad_percent" }, 400);
    var code;
    for(var tries = 0; tries < 20; tries++){
      code = randomCode(body.prefix);
      if(!findCoupon(list, code)) break;
    }
    var now = Date.now();
    var c = {
      code: code,
      percent: percent,
      note: String(body.note || "").trim().slice(0, 80),
      createdAt: now,
      expiresAt: now + COUPON_DAYS * 24 * 60 * 60 * 1000,
      active: true,
      perCustomer: cleanLimit(body.perCustomer),
      uses: []
    };
    list.push(c);
    await saveCoupons(env, list);
    return json({ ok:true, coupon: c });
  }

  var target = findCoupon(list, body && body.code);
  if(!target) return json({ ok:false, error:"not_found" }, 404);
  if(action === "limit"){
    target.perCustomer = cleanLimit(body.perCustomer);
    await saveCoupons(env, list);
    return json({ ok:true, coupon: target });
  }
  if(action === "toggle"){
    target.active = target.active === false;
    await saveCoupons(env, list);
    return json({ ok:true, coupon: target });
  }
  if(action === "delete"){
    var n = normCode(target.code);
    list = list.filter(function(x){ return normCode(x.code) !== n; });
    await saveCoupons(env, list);
    return json({ ok:true });
  }
  return json({ ok:false, error:"bad_request" }, 400);
}
