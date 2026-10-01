/* Discount codes shared by api/coupons.js (admin + "check" from the cart)
   and api/orders.js (applies the code when the order is placed).
   KV key "coupons" = [{ code, percent, note, createdAt, expiresAt, active,
                         uses:[{ customerId, phone, email, name, orderId, at }] }]
   Rule: a code can be used by many customers, but ONLY ONCE per customer.
   "Same customer" = same account, same phone number or same email, so a
   second device / logging in again / a new account on the same phone
   number can't reuse it.
   (ASCII-only comments on purpose, same as _lib.js.) */

export var COUPON_DAYS = 30;

export async function getCoupons(env){
  var raw = await env.STORE_KV.get("coupons");
  try{ var v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; }catch(e){ return []; }
}
export async function saveCoupons(env, list){
  await env.STORE_KV.put("coupons", JSON.stringify(list));
}
export function normCode(code){
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
/* Egyptian numbers: keep the last 10 digits so 010..., +2010..., 002010... match */
export function normPhone(p){
  var d = String(p || "").replace(/[^0-9]/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}
export function findCoupon(list, code){
  var n = normCode(code);
  if(!n) return null;
  return list.find(function(c){ return normCode(c.code) === n; }) || null;
}
export function couponState(c, now){
  if(!c) return "not_found";
  if(c.active === false) return "inactive";
  if((now || Date.now()) > (+c.expiresAt || 0)) return "expired";
  return "ok";
}
/* has this customer (account / phone / email) already used the code? */
export function usedBy(c, customer, phone){
  var ids = [];
  if(customer){
    ids.push({ k:"customerId", v:String(customer.identifier || "").toLowerCase() });
    if(customer.email) ids.push({ k:"email", v:String(customer.email).toLowerCase() });
    var ip = normPhone(customer.phone || customer.identifier);
    if(ip.length >= 10) ids.push({ k:"phone", v:ip });
  }
  var op = normPhone(phone);
  if(op.length >= 10) ids.push({ k:"phone", v:op });
  return (c.uses || []).some(function(u){
    return ids.some(function(x){ return x.v && String(u[x.k] || "").toLowerCase() === x.v; });
  });
}
