import { json } from "../_lib.js";

/* GET /api/stock - public. Returns ONLY the live stock numbers of every
   product (no photos, no descriptions), so it is tiny and always fresh.
   The site calls it when a customer opens a product and before checkout,
   so the "you can't add more than what's in stock" limit always uses the
   real current quantity, even if the phone is showing an older saved copy
   of the catalog.
   It also returns, for the admin app's stock notifications:
     lowStock  = the store's default low-stock alert level
     per item: name, lowAt (per-product alert level or null) and
     state = "out" (sold out) / "low" (at or under the alert level) /
             "ok" / "none" (stock not tracked)
   (same rules as the admin app screens).
   (ASCII-only comments on purpose, same as _lib.js.) */
function stateOf(p, def){
  var lim = (p.lowAt != null && !isNaN(+p.lowAt)) ? Math.max(0, Math.round(+p.lowAt)) : def;
  var parts = (Array.isArray(p.sizes) && p.sizes.length) ? p.sizes : ((Array.isArray(p.colors) && p.colors.length) ? p.colors : null);
  if(parts){
    var tracked = parts.filter(function(x){ return x.stock != null; });
    if(!tracked.length) return "none";
    if(parts.every(function(x){ return x.stock != null && +x.stock <= 0; })) return "out";
    if(tracked.some(function(x){ return +x.stock <= lim; })) return "low";
    return "ok";
  }
  if(p.stock == null) return "none";
  if(+p.stock <= 0) return "out";
  if(+p.stock <= lim) return "low";
  return "ok";
}

export async function onRequestGet({ env }){
  var raw = await env.STORE_KV.get("products");
  var catalog = null;
  try{ catalog = raw ? JSON.parse(raw) : null; }catch(e){ catalog = null; }
  var def = 3;
  if(catalog && catalog.settings && catalog.settings.lowStock != null && !isNaN(+catalog.settings.lowStock)) def = Math.max(0, Math.round(+catalog.settings.lowStock));
  var items = (catalog && Array.isArray(catalog.products) ? catalog.products : []).map(function(p){
    return {
      id: p.id,
      name: p.name || "",
      stock: p.stock == null ? null : p.stock,
      lowAt: p.lowAt == null ? null : p.lowAt,
      state: stateOf(p, def),
      sizes: Array.isArray(p.sizes) ? p.sizes.map(function(s){ return { label: s.label, stock: s.stock == null ? null : s.stock }; }) : [],
      colors: Array.isArray(p.colors) ? p.colors.map(function(c){ return { name: c.name, stock: c.stock == null ? null : c.stock }; }) : []
    };
  });
  return json({ ok:true, lowStock: def, items: items });
}
