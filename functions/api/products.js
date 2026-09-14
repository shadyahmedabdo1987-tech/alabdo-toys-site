import { json, requireAdmin } from "../_lib.js";

/* GET /api/products  -  public. Returns the live catalog stored in KV, or
   null if the admin hasn't saved anything yet (the site then falls back to
   the defaults built into store.html). */
export async function onRequestGet({ env }){
  var raw = await env.STORE_KV.get("products");
  if(!raw) return json(null);
  return new Response(raw, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

/* POST /api/products  -  admin only (X-Admin-User / X-Admin-Pass headers).
   Body: {categories:[...], products:[...]}. Replaces the whole catalog  - 
   this mirrors exactly what the admin dashboard already holds in memory. */
export async function onRequestPost({ request, env }){
  var acc = await requireAdmin(request, env);
  if(!acc) return json({ ok:false, error:"unauthorized" }, 401);

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  if(!body || !Array.isArray(body.categories) || !Array.isArray(body.products)){
    return json({ ok:false, error:"bad_request" }, 400);
  }
  await env.STORE_KV.put("products", JSON.stringify({ categories: body.categories, products: body.products }));
  return json({ ok:true });
}
