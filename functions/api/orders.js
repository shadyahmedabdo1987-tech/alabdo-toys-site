import { json, getList, saveList, requireAdmin, requireCustomer } from "../_lib.js";

/* GET /api/orders - admin headers return every order (for the admin
   dashboard's order list); customer headers return only that customer's
   own orders (used to render "My Orders" and, more importantly, as the
   proof a review is checked against). */
export async function onRequestGet({ request, env }){
  var admin = await requireAdmin(request, env);
  if(admin){
    var all = await getList(env, "orders");
    return json({ ok:true, orders: all });
  }
  var customer = await requireCustomer(request, env);
  if(customer){
    var list = await getList(env, "orders");
    var mine = list.filter(function(o){ return o.customerId === customer.identifier; });
    return json({ ok:true, orders: mine });
  }
  return json({ ok:false, error:"unauthorized" }, 401);
}

/* POST /api/orders - customer only. A checkout only becomes a real,
   trackable order (and only then counts toward review eligibility) when
   the customer is logged in at checkout time; guest WhatsApp orders are
   not recorded here. Body: {items:[{id,name,price,qty}], total, name,
   phone, address}. */
export async function onRequestPost({ request, env }){
  var customer = await requireCustomer(request, env);
  if(!customer) return json({ ok:false, error:"unauthorized" }, 401);

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  if(!body || !Array.isArray(body.items) || !body.items.length){
    return json({ ok:false, error:"bad_request" }, 400);
  }

  var order = {
    id: "ord_" + Date.now().toString(36) + Math.floor(Math.random() * 999),
    customerId: customer.identifier,
    customerName: customer.name,
    items: body.items,
    total: +body.total || 0,
    name: (body.name || "").trim(),
    phone: (body.phone || "").trim(),
    address: (body.address || "").trim(),
    createdAt: Date.now()
  };
  var list = await getList(env, "orders");
  list.push(order);
  await saveList(env, "orders", list);
  return json({ ok:true, orderId: order.id });
}

/* PUT /api/orders - admin only. Body: {id, items, total, name, phone,
   address}. Lets the store owner fix a mistake in an already-placed order
   (wrong quantity/price, a typo in the address, ...) without deleting and
   recreating it. customerId/customerName/createdAt are never changed. */
export async function onRequestPut({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var id = body && body.id;
  if(!id) return json({ ok:false, error:"missing_id" }, 400);
  if(!body || !Array.isArray(body.items) || !body.items.length){
    return json({ ok:false, error:"bad_request" }, 400);
  }

  var list = await getList(env, "orders");
  var idx = list.findIndex(function(o){ return o.id === id; });
  if(idx === -1) return json({ ok:false, error:"not_found" }, 404);

  var o = list[idx];
  o.items = body.items;
  o.total = +body.total || 0;
  o.name = (body.name || "").trim();
  o.phone = (body.phone || "").trim();
  o.address = (body.address || "").trim();
  list[idx] = o;
  await saveList(env, "orders", list);
  return json({ ok:true, order:o });
}

/* DELETE /api/orders - admin only. Body: {id}. Permanently removes one
   order (e.g. a duplicate or a cancelled/test order) from the recorded
   list - this cannot be undone. */
export async function onRequestDelete({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var id = body && body.id;
  if(!id) return json({ ok:false, error:"missing_id" }, 400);

  var list = await getList(env, "orders");
  var next = list.filter(function(o){ return o.id !== id; });
  if(next.length === list.length) return json({ ok:false, error:"not_found" }, 404);
  await saveList(env, "orders", next);
  return json({ ok:true });
}
