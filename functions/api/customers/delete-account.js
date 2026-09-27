import { json, getCustomers, saveCustomers, getList, saveList, requireCustomer } from "../../_lib.js";

/* POST /api/customers/delete-account - customer only (X-Customer-Id /
   X-Customer-Pass headers, same as every other customer endpoint).
   Permanently deletes the logged-in customer's own account: login data,
   name, email, phone, saved address and favorites, plus every product
   review they wrote. Past orders are kept as the store's sales records
   (invoices) but are unlinked from the deleted account. Required by Google
   Play's account deletion policy (in-app + web deletion path).
   (ASCII-only comments on purpose, same as _lib.js.) */
export async function onRequestPost({ request, env }){
  var customer = await requireCustomer(request, env);
  if(!customer) return json({ ok:false, error:"unauthorized" }, 401);
  var id = customer.identifier;

  var list = await getCustomers(env);
  var next = list.filter(function(c){ return c.identifier !== id; });
  await saveCustomers(env, next);

  try{
    var reviews = await getList(env, "reviews");
    var keptReviews = reviews.filter(function(r){ return r.customerId !== id; });
    if(keptReviews.length !== reviews.length) await saveList(env, "reviews", keptReviews);
  }catch(e){ /* the account itself is already deleted */ }

  try{
    var orders = await getList(env, "orders");
    var changed = false;
    orders.forEach(function(o){
      if(o.customerId === id){ o.customerId = null; changed = true; }
    });
    if(changed) await saveList(env, "orders", orders);
  }catch(e){ /* the account itself is already deleted */ }

  return json({ ok:true });
}
