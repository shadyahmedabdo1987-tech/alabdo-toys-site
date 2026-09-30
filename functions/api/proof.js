import { json, requireAdmin, requireCustomer, getList } from "../_lib.js";

/* Payment-transfer screenshots (Vodafone Cash / InstaPay) attached to orders.
   orders.js stores each one on its own in KV (key "proof:<orderId>") at full
   quality, so the orders list stays small.

   GET /api/proof?id=<orderId>
       - admin (X-Admin-User / X-Admin-Pass): any order.
       - customer (X-Customer-Id / X-Customer-Pass): only their own order.
       Returns the image bytes (never cached by shared caches).
       Older orders that still carry the image inside the order itself
       (paymentProof data: URL) are served the same way.
   (ASCII-only comments on purpose, same as _lib.js.) */

function b64ToBytes(b64){
  var bin = atob(b64.replace(/\s+/g, ""));
  var bytes = new Uint8Array(bin.length);
  for(var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function onRequestGet({ request, env }){
  var url = new URL(request.url);
  var id = String(url.searchParams.get("id") || "");
  if(!/^ord_[a-z0-9]{4,40}$/i.test(id)) return json({ ok:false, error:"bad_id" }, 400);

  var admin = await requireAdmin(request, env);
  var order = null;
  if(!admin){
    var customer = await requireCustomer(request, env);
    if(!customer) return json({ ok:false, error:"unauthorized" }, 401);
    var list = await getList(env, "orders");
    order = list.find(function(o){ return o.id === id; }) || null;
    if(!order || order.customerId !== customer.identifier) return json({ ok:false, error:"not_found" }, 404);
  }

  var headers = {
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff"
  };

  var got = await env.STORE_KV.getWithMetadata("proof:" + id, { type: "arrayBuffer" });
  if(got && got.value){
    headers["content-type"] = (got.metadata && got.metadata.type) || "image/jpeg";
    return new Response(got.value, { headers: headers });
  }

  /* legacy: image embedded in the order record */
  if(!order){
    var all = await getList(env, "orders");
    order = all.find(function(o){ return o.id === id; }) || null;
  }
  var m = order && typeof order.paymentProof === "string"
    ? /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(order.paymentProof)
    : null;
  if(!m) return json({ ok:false, error:"not_found" }, 404);
  try{
    headers["content-type"] = m[1];
    return new Response(b64ToBytes(m[2]), { headers: headers });
  }catch(e){
    return json({ ok:false, error:"bad_image" }, 500);
  }
}
