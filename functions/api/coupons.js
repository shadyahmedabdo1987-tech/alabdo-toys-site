import { json, requireAdmin, requireCustomer } from "../_lib.js";
import { getCoupons, saveCoupons, findCoupon, couponState, usedBy, normCode, COUPON_DAYS } from "../_coupons.js";

/* Discount codes.
   GET  /api/coupons                         admin: every code + who used it
   POST /api/coupons {action:"create", percent, note}   admin: new code (valid 30 days)
        {action:"toggle", code}                          admin: stop / resume a code
        {action:"delete", code}                          admin: delete a code
        {action:"check", code, phone}         logged-in customer: is the code
                                              valid for me? -> {ok, code, percent, expiresAt}
   (ASCII-only comments on purpose, same as _lib.js.) */

var ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; /* no 0/O/1/I - easy to read & type */
function randomCode(){
  var a = new Uint8Array(6);
  crypto.getRandomValues(a);
  var s = "";
  for(var i = 0; i < a.length; i++) s += ALPHA[a[i] % ALPHA.length];
  return "ABDO-" + s;
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
    if(usedBy(c0, customer, body.phone)) return json({ ok:false, error:"used" }, 409);
    return json({ ok:true, code: c0.code, percent: c0.percent, expiresAt: c0.expiresAt });
  }

  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var list = await getCoupons(env);

  if(action === "create"){
    var percent = Math.round(+body.percent);
    if(!(percent >= 1 && percent <= 90)) return json({ ok:false, error:"bad_percent" }, 400);
    var code;
    for(var tries = 0; tries < 20; tries++){
      code = randomCode();
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
      uses: []
    };
    list.push(c);
    await saveCoupons(env, list);
    return json({ ok:true, coupon: c });
  }

  var target = findCoupon(list, body && body.code);
  if(!target) return json({ ok:false, error:"not_found" }, 404);
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
