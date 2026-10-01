import { json, getList, saveList, requireAdmin, requireCustomer } from "../_lib.js";

/* "Request a product" (customer asks the store to bring in a toy that is not
   in the catalog). Stored as one array under KV key "productRequests".

   Customer (X-Customer-Id / X-Customer-Pass):
     GET  /api/product-requests            -> {ok, requests:[own, newest first], unread}
     POST {action:"create", productName, specs, qty, image}  image = data: URL (optional)
     POST {action:"seen"}                  -> marks every reply as read
     POST {action:"remove", id}            -> deletes one of their own requests
   Admin (X-Admin-User / X-Admin-Pass):
     GET  /api/product-requests            -> {ok, requests:[all, oldest first]}
     POST {action:"reply", id, status:"available"|"unavailable", message, price, productId, image}
          image = "/api/img?id=..." link or a data: URL (stored the same way)
     POST {action:"delete", id}

   Photos (customer's and admin's) are stored like product photos (KV key
   "img:<hash>", served by /api/img) so they open with a normal link.
   (ASCII-only comments on purpose, same as _lib.js.) */

var KEY = "productRequests";
var MAX_KEEP = 500;
var MAX_IMG = 3 * 1024 * 1024;

function clean(v, max){ return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max); }
function cleanText(v, max){ return String(v == null ? "" : v).replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, max); }

async function storeImage(env, dataUrl){
  var m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+\/=\s]+)$/.exec(String(dataUrl || ""));
  if(!m) return { error: "bad_image" };
  var type = m[1] === "image/jpg" ? "image/jpeg" : m[1];
  var bin;
  try{ bin = atob(m[2].replace(/\s+/g, "")); }catch(e){ return { error: "bad_image" }; }
  if(bin.length > MAX_IMG) return { error: "too_big" };
  var bytes = new Uint8Array(bin.length);
  for(var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  var digest = await crypto.subtle.digest("SHA-256", bytes);
  var id = Array.from(new Uint8Array(digest)).slice(0, 16).map(function(b){ return b.toString(16).padStart(2, "0"); }).join("");
  var exists = await env.STORE_KV.get("img:" + id, { type: "arrayBuffer" });
  if(!exists) await env.STORE_KV.put("img:" + id, bytes.buffer, { metadata: { type: type, size: bytes.length, at: Date.now() } });
  return { url: "/api/img?id=" + id };
}

function forCustomer(r){
  return {
    id: r.id, productName: r.productName, specs: r.specs, qty: r.qty, image: r.image || null,
    status: r.status, createdAt: r.createdAt,
    reply: r.reply || null, seen: r.seen !== false
  };
}

function sameCustomer(r, acc){
  return String(r.customerId || "").toLowerCase() === String(acc.identifier || "").toLowerCase();
}

export async function onRequestGet({ request, env }){
  var admin = await requireAdmin(request, env);
  var list = await getList(env, KEY);
  if(admin) return json({ ok:true, requests: list });
  var acc = await requireCustomer(request, env);
  if(!acc) return json({ ok:false, error:"unauthorized" }, 401);
  var mine = list.filter(function(r){ return sameCustomer(r, acc); }).reverse().map(forCustomer);
  var unread = mine.filter(function(r){ return r.reply && !r.seen; }).length;
  return json({ ok:true, requests: mine, unread: unread });
}

export async function onRequestPost({ request, env }){
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var action = body && body.action;

  var admin = (request.headers.get("X-Admin-User") ? await requireAdmin(request, env) : null);
  if(admin){
    var all = await getList(env, KEY);
    var r = all.find(function(x){ return x.id === body.id; });
    if(action === "delete"){
      if(!r) return json({ ok:false, error:"not_found" }, 404);
      await saveList(env, KEY, all.filter(function(x){ return x.id !== body.id; }));
      return json({ ok:true });
    }
    if(action === "reply"){
      if(!r) return json({ ok:false, error:"not_found" }, 404);
      var status = body.status === "available" ? "available" : (body.status === "unavailable" ? "unavailable" : "");
      if(!status) return json({ ok:false, error:"bad_status" }, 400);
      var img = String(body.image || "");
      var imgUrl = null;
      if(/^\/api\/img\?id=[a-f0-9]{16,64}$/.test(img)) imgUrl = img;
      else if(img.indexOf("data:image/") === 0){
        var st = await storeImage(env, img);
        if(st.error) return json({ ok:false, error: st.error }, 400);
        imgUrl = st.url;
      }
      var price = +body.price;
      r.status = status;
      r.reply = {
        message: cleanText(body.message, 600),
        price: (isFinite(price) && price > 0) ? Math.round(price * 100) / 100 : null,
        productId: clean(body.productId, 80) || null,
        image: imgUrl,
        at: Date.now()
      };
      r.seen = false;
      await saveList(env, KEY, all);
      return json({ ok:true, request: r });
    }
    return json({ ok:false, error:"bad_request" }, 400);
  }

  var acc = await requireCustomer(request, env);
  if(!acc) return json({ ok:false, error:"login_required" }, 401);
  var list = await getList(env, KEY);

  if(action === "seen"){
    var changed = false;
    list.forEach(function(x){ if(sameCustomer(x, acc) && x.reply && x.seen === false){ x.seen = true; changed = true; } });
    if(changed) await saveList(env, KEY, list);
    return json({ ok:true });
  }
  if(action === "remove"){
    var next = list.filter(function(x){ return !(x.id === body.id && sameCustomer(x, acc)); });
    if(next.length === list.length) return json({ ok:false, error:"not_found" }, 404);
    await saveList(env, KEY, next);
    return json({ ok:true });
  }
  if(action !== "create") return json({ ok:false, error:"bad_request" }, 400);

  var productName = clean(body.productName, 90);
  var specs = cleanText(body.specs, 600);
  var qty = Math.max(1, Math.min(99, Math.round(+body.qty || 1)));
  if(productName.length < 2) return json({ ok:false, error:"missing_name" }, 400);

  /* limits so nobody floods the list */
  var mine = list.filter(function(x){ return sameCustomer(x, acc); });
  var pending = mine.filter(function(x){ return x.status === "pending"; }).length;
  var dayAgo = Date.now() - 24 * 3600 * 1000;
  var today = mine.filter(function(x){ return (x.createdAt || 0) > dayAgo; }).length;
  if(pending >= 5) return json({ ok:false, error:"too_many_pending" }, 429);
  if(today >= 8) return json({ ok:false, error:"too_many_today" }, 429);

  var imageUrl = null;
  if(body.image){
    var saved = await storeImage(env, body.image);
    if(saved.error) return json({ ok:false, error: saved.error }, 400);
    imageUrl = saved.url;
  }

  var item = {
    id: "pr_" + Date.now().toString(36) + Math.floor(Math.random() * 999),
    customerId: acc.identifier,
    name: acc.name || "",
    phone: acc.identifier,
    governorate: acc.governorate || "",
    productName: productName,
    specs: specs,
    qty: qty,
    image: imageUrl,
    status: "pending",
    reply: null,
    seen: true,
    createdAt: Date.now()
  };
  list.push(item);
  if(list.length > MAX_KEEP){
    /* drop the oldest answered requests first, never pending ones */
    var extra = list.length - MAX_KEEP;
    list = list.filter(function(x){ if(extra > 0 && x.status !== "pending"){ extra--; return false; } return true; });
  }
  await saveList(env, KEY, list);
  return json({ ok:true, request: forCustomer(item) });
}
