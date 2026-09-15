import { json, getCustomers, saveCustomers, requireCustomer } from "../../_lib.js";

/* GET /api/customers/favorites - customer only. Returns this customer's own
   saved favorite product ids, stored on their account in KV (not the
   browser), so favorites stay tied to the account itself and never leak
   across devices or to another logged-in user on the same browser. */
export async function onRequestGet({ request, env }){
  var customer = await requireCustomer(request, env);
  if(!customer) return json({ ok:false, error:"unauthorized" }, 401);
  return json({ ok:true, favorites: Array.isArray(customer.favorites) ? customer.favorites : [] });
}

/* POST /api/customers/favorites - customer only. Body: {productId, on}.
   Adds or removes one product id from this customer's saved favorites and
   returns the full updated list. */
export async function onRequestPost({ request, env }){
  var customer = await requireCustomer(request, env);
  if(!customer) return json({ ok:false, error:"unauthorized" }, 401);

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  if(!body || body.productId===undefined || body.productId===null){
    return json({ ok:false, error:"bad_request" }, 400);
  }

  var list = await getCustomers(env);
  var acc = list.find(function(c){ return c.identifier === customer.identifier; });
  if(!acc) return json({ ok:false, error:"unauthorized" }, 401);
  if(!Array.isArray(acc.favorites)) acc.favorites = [];

  var pid = body.productId;
  var idx = acc.favorites.findIndex(function(x){ return String(x) === String(pid); });
  if(body.on){
    if(idx === -1) acc.favorites.push(pid);
  } else {
    if(idx > -1) acc.favorites.splice(idx, 1);
  }
  await saveCustomers(env, list);
  return json({ ok:true, favorites: acc.favorites });
}
