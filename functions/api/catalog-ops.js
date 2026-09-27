import { json, requireAdmin } from "../_lib.js";

/* POST /api/catalog-ops - admin only (X-Admin-User / X-Admin-Pass headers).
   Body: { ops: [ ... ] }. Applies small, targeted changes to the saved
   catalog ON THE SERVER, instead of the admin app uploading the whole
   catalog (every product with all its photos) for every little change.
   Why: uploading the full catalog on every +1 was slow on mobile data, and
   when two saves overlapped the older copy could land last and silently
   undo the newer change. Now each change is a few bytes, is applied to the
   latest saved catalog here, and the admin app retries it until it gets
   an ok (it keeps unsent changes on the phone).
   Supported ops (applied in order):
     {op:"stock",  id, delta, colorName?, sizeLabel?}   add/subtract stock
     {op:"set",    id, price?, old?, stock?, sizes?:[{label,price,stock}], colors?:[{name,stock}]}
     {op:"upsert", product}         add a product, or update it (merge by id)
     {op:"delete", id}
     {op:"cat-upsert", category}    add/update a category (merge by id)
     {op:"cat-delete", id}          refused if products still use it
   Returns { ok, rev, changed:[{id, price, old, stock, sizes, colors}], deleted:[ids] }
   (only stock/price fields, no photos, so the response stays tiny).
   (ASCII-only comments on purpose, same as _lib.js.) */

function has(o, k){ return Object.prototype.hasOwnProperty.call(o, k); }
function numOrNull(v){
  if(v === null || v === undefined || v === "") return null;
  var n = Math.round(+v);
  return isNaN(n) ? null : Math.max(0, n);
}
function money(v){ var n = +v; return isNaN(n) ? 0 : Math.max(0, n); }
function summary(p){
  return {
    id: p.id,
    price: p.price,
    old: p.old == null ? null : p.old,
    stock: p.stock == null ? null : p.stock,
    sizes: Array.isArray(p.sizes) ? p.sizes.map(function(s){ return { label: s.label, price: s.price, stock: s.stock == null ? null : s.stock }; }) : [],
    colors: Array.isArray(p.colors) ? p.colors.map(function(c){ return { name: c.name, stock: c.stock == null ? null : c.stock }; }) : []
  };
}

export async function onRequestPost({ request, env }){
  var acc = await requireAdmin(request, env);
  if(!acc) return json({ ok:false, error:"unauthorized" }, 401);

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var ops = body && Array.isArray(body.ops) ? body.ops : null;
  if(!ops || !ops.length) return json({ ok:false, error:"bad_request" }, 400);

  var raw = await env.STORE_KV.get("products");
  var catalog = null;
  try{ catalog = raw ? JSON.parse(raw) : null; }catch(e){ catalog = null; }
  if(!catalog || !Array.isArray(catalog.products) || !Array.isArray(catalog.categories)){
    return json({ ok:false, error:"no_catalog" }, 409);
  }

  var changedIds = {};
  var deleted = [];
  var skipped = [];
  function findP(id){ return catalog.products.find(function(x){ return String(x.id) === String(id); }); }

  ops.forEach(function(o, i){
    if(!o || typeof o !== "object") return;
    var p;
    if(o.op === "stock"){
      p = findP(o.id); if(!p){ skipped.push(i); return; }
      var d = Math.round(+o.delta || 0);
      var sizeLabel = String(o.sizeLabel || "");
      var colorName = String(o.colorName || "");
      if(sizeLabel && Array.isArray(p.sizes)){
        var s = p.sizes.find(function(x){ return x.label === sizeLabel; });
        if(s && s.stock != null) s.stock = Math.max(0, (+s.stock || 0) + d);
      } else if(colorName && Array.isArray(p.colors)){
        var c = p.colors.find(function(x){ return x.name === colorName; });
        if(c && c.stock != null) c.stock = Math.max(0, (+c.stock || 0) + d);
      } else if(p.stock != null){
        p.stock = Math.max(0, (+p.stock || 0) + d);
      }
      changedIds[String(p.id)] = true;
    }
    else if(o.op === "set"){
      p = findP(o.id); if(!p){ skipped.push(i); return; }
      if(has(o, "price")) p.price = money(o.price);
      if(has(o, "old")) p.old = (o.old === null || o.old === "" ) ? null : money(o.old);
      if(has(o, "stock")) p.stock = numOrNull(o.stock);
      if(Array.isArray(o.sizes) && Array.isArray(p.sizes)){
        o.sizes.forEach(function(ns){
          var s2 = p.sizes.find(function(x){ return x.label === ns.label; });
          if(!s2) return;
          if(has(ns, "price")) s2.price = money(ns.price);
          if(has(ns, "stock")) s2.stock = numOrNull(ns.stock);
        });
      }
      if(Array.isArray(o.colors) && Array.isArray(p.colors)){
        o.colors.forEach(function(nc){
          var c2 = p.colors.find(function(x){ return x.name === nc.name; });
          if(c2 && has(nc, "stock")) c2.stock = numOrNull(nc.stock);
        });
      }
      changedIds[String(p.id)] = true;
    }
    else if(o.op === "upsert"){
      var np = o.product;
      if(!np || np.id == null || !np.name){ skipped.push(i); return; }
      p = findP(np.id);
      if(p) Object.assign(p, np);
      else catalog.products.push(np);
      changedIds[String(np.id)] = true;
    }
    else if(o.op === "delete"){
      var before = catalog.products.length;
      catalog.products = catalog.products.filter(function(x){ return String(x.id) !== String(o.id); });
      if(catalog.products.length !== before) deleted.push(o.id);
      delete changedIds[String(o.id)];
    }
    else if(o.op === "cat-upsert"){
      var nc2 = o.category;
      if(!nc2 || !nc2.id || !nc2.name){ skipped.push(i); return; }
      var cat = catalog.categories.find(function(x){ return x.id === nc2.id; });
      if(cat) Object.assign(cat, nc2);
      else catalog.categories.push(nc2);
    }
    else if(o.op === "cat-delete"){
      var inUse = catalog.products.some(function(x){ return x.cat === o.id; });
      if(inUse){ skipped.push(i); return; }
      catalog.categories = catalog.categories.filter(function(x){ return x.id !== o.id; });
    }
    else skipped.push(i);
  });

  catalog.rev = (+catalog.rev || 0) + 1;
  catalog.updatedAt = Date.now();
  await env.STORE_KV.put("products", JSON.stringify(catalog));

  var changed = Object.keys(changedIds).map(function(id){ var x = findP(id); return x ? summary(x) : null; }).filter(Boolean);
  return json({ ok:true, rev: catalog.rev, changed: changed, deleted: deleted, skipped: skipped, categories: catalog.categories });
}
