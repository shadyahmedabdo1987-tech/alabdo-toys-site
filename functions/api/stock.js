import { json } from "../_lib.js";

/* GET /api/stock - public. Returns ONLY the live stock numbers of every
   product (no photos, no descriptions), so it is tiny and always fresh.
   The site calls it when a customer opens a product and before checkout,
   so the "you can't add more than what's in stock" limit always uses the
   real current quantity, even if the phone is showing an older saved copy
   of the catalog. (ASCII-only comments on purpose, same as _lib.js.) */
export async function onRequestGet({ env }){
  var raw = await env.STORE_KV.get("products");
  var catalog = null;
  try{ catalog = raw ? JSON.parse(raw) : null; }catch(e){ catalog = null; }
  var items = (catalog && Array.isArray(catalog.products) ? catalog.products : []).map(function(p){
    return {
      id: p.id,
      stock: p.stock == null ? null : p.stock,
      sizes: Array.isArray(p.sizes) ? p.sizes.map(function(s){ return { label: s.label, stock: s.stock == null ? null : s.stock }; }) : [],
      colors: Array.isArray(p.colors) ? p.colors.map(function(c){ return { name: c.name, stock: c.stock == null ? null : c.stock }; }) : []
    };
  });
  return json({ ok:true, items: items });
}
