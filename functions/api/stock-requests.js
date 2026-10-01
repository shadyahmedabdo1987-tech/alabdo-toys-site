import { json, getList, saveList, requireAdmin, requireCustomer } from "../_lib.js";
import { addNote, phoneTail, hasAccountFor } from "../_notes.js";

/* GET /api/stock-requests - admin only. Returns every "أعلمني عند التوفر"
   request customers have submitted for out-of-stock products/colors, so the
   admin dashboard can list them for follow-up. */
export async function onRequestGet({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var list = await getList(env, "stockRequests");
  return json({ ok:true, requests: list });
}

/* POST /api/stock-requests - public, no login required (same spirit as the
   guest WhatsApp checkout path - a browsing customer shouldn't need an
   account just to ask to be notified). Body: {productId, productName,
   colorName, name, phone}. phone is the only required field. */
export async function onRequestPost({ request, env }){
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  if(!body || !body.productId || !String(body.phone||"").trim()){
    return json({ ok:false, error:"bad_request" }, 400);
  }

  var cust = request.headers.get("X-Customer-Id") ? await requireCustomer(request, env) : null;
  var item = {
    id: "sr_" + Date.now().toString(36) + Math.floor(Math.random() * 999),
    customerId: cust ? cust.identifier : null,
    productId: body.productId,
    productName: (body.productName || "").trim(),
    colorName: (body.colorName || "").trim() || null,
    sizeLabel: (body.sizeLabel || "").trim() || null,
    name: (body.name || "").trim(),
    phone: (body.phone || "").trim(),
    createdAt: Date.now()
  };
  var list = await getList(env, "stockRequests");
  list.push(item);
  await saveList(env, "stockRequests", list);
  return json({ ok:true });
}

/* DELETE /api/stock-requests - admin only. Body: {id}. Removes a request once
   the admin has restocked the product and contacted the customer. */
export async function onRequestDelete({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var id = body && body.id;
  if(!id) return json({ ok:false, error:"missing_id" }, 400);

  var list = await getList(env, "stockRequests");
  var next = list.filter(function(r){ return r.id !== id; });
  if(next.length === list.length) return json({ ok:false, error:"not_found" }, 404);
  await saveList(env, "stockRequests", next);
  return json({ ok:true });
}

/* PUT /api/stock-requests - admin only. Body: {id, message}. Tells the
   customer (in their bell) that the product they waited for is back, then
   removes the request from the admin list. Returns {ok, hasAccount}. */
export async function onRequestPut({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  if(!body || !body.id) return json({ ok:false, error:"bad_request" }, 400);
  var list = await getList(env, "stockRequests");
  var r = list.find(function(x){ return x.id === body.id; });
  if(!r) return json({ ok:false, error:"not_found" }, 404);
  var variant = [r.colorName, r.sizeLabel].filter(Boolean).join(" - ");
  await addNote(env, {
    type: "stock",
    customerId: r.customerId || null,
    phoneTail: phoneTail(r.phone),
    title: (r.productName || "") + (variant ? " (" + variant + ")" : ""),
    productId: r.productId || null,
    message: String(body.message || "").replace(/\r/g, "").trim().slice(0, 600)
  });
  await saveList(env, "stockRequests", list.filter(function(x){ return x.id !== body.id; }));
  return json({ ok:true, hasAccount: await hasAccountFor(env, r.phone, r.customerId) });
}
