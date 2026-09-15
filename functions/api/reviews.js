import { json, getList, saveList, requireCustomer } from "../_lib.js";

/* GET /api/reviews?productId=... - public. Returns the reviews for one
   product plus a computed average and count, so the client can show real
   customer ratings instead of the admin-set seed numbers once any real
   reviews exist. */
export async function onRequestGet({ request, env }){
  var url = new URL(request.url);
  var productId = url.searchParams.get("productId") || "";
  var all = await getList(env, "reviews");
  var list = productId ? all.filter(function(r){ return String(r.productId) === String(productId); }) : all;
  var count = list.length;
  var avg = count ? (list.reduce(function(s, r){ return s + (+r.rating || 0); }, 0) / count) : 0;
  return json({ ok:true, reviews: list, avg: avg, count: count });
}

/* POST /api/reviews - customer only. Body: {productId, rating, comment}.
   Only accepted when the customer has a recorded order (see orders.js)
   containing this exact product - this is the actual "did they buy it"
   check. A customer reviewing the same product twice updates their
   existing review instead of adding a duplicate. */
export async function onRequestPost({ request, env }){
  var customer = await requireCustomer(request, env);
  if(!customer) return json({ ok:false, error:"unauthorized" }, 401);

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var productId = body && body.productId;
  var rating = +(body && body.rating);
  var comment = ((body && body.comment) || "").trim();
  if(!productId || !(rating >= 1 && rating <= 5)){
    return json({ ok:false, error:"bad_request" }, 400);
  }

  var orders = await getList(env, "orders");
  var purchased = orders.some(function(o){
    if(o.customerId !== customer.identifier) return false;
    return (o.items || []).some(function(it){ return String(it.id) === String(productId); });
  });
  if(!purchased){ return json({ ok:false, error:"not_purchased" }, 403); }

  var reviews = await getList(env, "reviews");
  var idx = reviews.findIndex(function(r){
    return r.customerId === customer.identifier && String(r.productId) === String(productId);
  });
  var entry = {
    id: idx > -1 ? reviews[idx].id : ("rev_" + Date.now().toString(36) + Math.floor(Math.random() * 999)),
    productId: productId,
    customerId: customer.identifier,
    customerName: customer.name,
    rating: rating,
    comment: comment,
    createdAt: Date.now()
  };
  if(idx > -1){ reviews[idx] = entry; } else { reviews.push(entry); }
  await saveList(env, "reviews", reviews);
  return json({ ok:true });
}
