import { json, getList, saveList, requireCustomer } from "../_lib.js";
import { getNotes, saveNotes, noteMatches } from "../_notes.js";

/* The customer's bell: every reply from the store in one list.
   GET  /api/notifications            (X-Customer-Id / X-Customer-Pass)
        -> {ok, items:[newest first], unread}
        item.kind: "preq" (reply to a product request), "inquiry" (reply to a
        contact-us message), "stock" (a product they waited for is back),
        "order" (the store changed the status of one of their orders).
   POST {action:"seen"}               -> marks everything as read
   POST {action:"remove", id}         -> hides one item from their bell
   (ASCII-only comments on purpose, same as _lib.js.) */

function sameCustomer(r, acc){ return String(r.customerId || "").toLowerCase() === String(acc.identifier || "").toLowerCase(); }

export async function onRequestGet({ request, env }){
  var acc = await requireCustomer(request, env);
  if(!acc) return json({ ok:false, error:"unauthorized" }, 401);
  var items = [];
  (await getList(env, "productRequests")).forEach(function(r){
    if(!sameCustomer(r, acc) || !r.reply || r.hiddenForCustomer) return;
    items.push({
      id: r.id, kind: "preq", at: r.reply.at || r.createdAt, seen: r.seen !== false,
      status: r.status, productName: r.productName, specs: r.specs, qty: r.qty, image: r.image || null,
      reply: r.reply
    });
  });
  (await getNotes(env)).forEach(function(n){
    if(!noteMatches(n, acc)) return;
    items.push({
      id: n.id, kind: n.type, at: n.at, seen: n.seen !== false,
      title: n.title || "", quote: n.quote || "", message: n.message || "",
      productId: n.productId || null, image: n.image || null,
      orderId: n.orderId || null, status: n.status || null
    });
  });
  items.sort(function(a, b){ return (b.at || 0) - (a.at || 0); });
  var unread = items.filter(function(i){ return !i.seen; }).length;
  return json({ ok:true, items: items, unread: unread });
}

export async function onRequestPost({ request, env }){
  var acc = await requireCustomer(request, env);
  if(!acc) return json({ ok:false, error:"unauthorized" }, 401);
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var action = body && body.action;
  var reqs = await getList(env, "productRequests");
  var notes = await getNotes(env);

  if(action === "seen"){
    var c1 = false, c2 = false;
    reqs.forEach(function(r){ if(sameCustomer(r, acc) && r.reply && r.seen === false){ r.seen = true; c1 = true; } });
    notes.forEach(function(n){ if(noteMatches(n, acc) && n.seen === false){ n.seen = true; c2 = true; } });
    if(c1) await saveList(env, "productRequests", reqs);
    if(c2) await saveNotes(env, notes);
    return json({ ok:true });
  }
  if(action === "remove" && body.id){
    var id = String(body.id);
    if(id.indexOf("pr_") === 0){
      var r = reqs.find(function(x){ return x.id === id && sameCustomer(x, acc); });
      if(!r) return json({ ok:false, error:"not_found" }, 404);
      r.hiddenForCustomer = true; r.seen = true;
      await saveList(env, "productRequests", reqs);
      return json({ ok:true });
    }
    var next = notes.filter(function(n){ return !(n.id === id && noteMatches(n, acc)); });
    if(next.length === notes.length) return json({ ok:false, error:"not_found" }, 404);
    await saveNotes(env, next);
    return json({ ok:true });
  }
  return json({ ok:false, error:"bad_request" }, 400);
}
