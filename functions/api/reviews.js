import { json, getList, saveList, requireCustomer, requireAdmin } from "../_lib.js";

/* GET /api/reviews?productId=... - public. Returns the reviews for one
   product plus a computed average and count, so the client can show real
   customer ratings instead of the admin-set seed numbers once any real
   reviews exist. */
export async function onRequestGet({ request, env }){
  var url = new URL(request.url);
  var productId = url.searchParams.get("productId") || "";
  var all = await getList(env, "reviews");
  /* admin (X-Admin-User / X-Admin-Pass): every review, hidden ones and the
     customer's phone included, for the reviews page in the dashboard */
  if(request.headers.get("X-Admin-User") && await requireAdmin(request, env)){
    return json({ ok:true, reviews: all });
  }
  /* public: hidden reviews are left out and the phone number never leaves
     the server */
  var list = all.filter(function(r){ return !r.hidden && (!productId || String(r.productId) === String(productId)); })
    .map(function(r){ return { id: r.id, productId: r.productId, customerName: r.customerName, rating: r.rating, comment: r.comment, createdAt: r.createdAt, edited: !!r.editedByAdmin }; });
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

/* PUT /api/reviews - admin only. Body: {id, rating?, comment?, hidden?}.
   Changing the rating or the text marks the review as edited by the store
   (shown publicly as a small note, so shoppers know it is not the original
   wording). hidden:true keeps it but stops showing it to shoppers. */
export async function onRequestPut({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var reviews = await getList(env, "reviews");
  var r = reviews.find(function(x){ return x.id === (body && body.id); });
  if(!r) return json({ ok:false, error:"not_found" }, 404);
  var changed = false, before = { rating: r.rating, comment: r.comment || "" };
  if(body.rating != null){
    var rating = Math.round(+body.rating);
    if(!(rating >= 1 && rating <= 5)) return json({ ok:false, error:"bad_rating" }, 400);
    if(rating !== +r.rating){ r.rating = rating; changed = true; }
  }
  if(body.comment != null){
    var comment = String(body.comment).trim().slice(0, 1000);
    if(comment !== String(r.comment || "")){ r.comment = comment; changed = true; }
  }
  if(changed){
    if(!r.original) r.original = before;
    r.editedByAdmin = true; r.editedAt = Date.now();
  }
  if(body.hidden != null) r.hidden = !!body.hidden;
  await saveList(env, "reviews", reviews);
  return json({ ok:true, review: r });
}

/* DELETE /api/reviews - admin only. Body: {id}. Removes the review for good. */
export async function onRequestDelete({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var reviews = await getList(env, "reviews");
  var next = reviews.filter(function(x){ return x.id !== (body && body.id); });
  if(next.length === reviews.length) return json({ ok:false, error:"not_found" }, 404);
  await saveList(env, "reviews", next);
  return json({ ok:true });
}
