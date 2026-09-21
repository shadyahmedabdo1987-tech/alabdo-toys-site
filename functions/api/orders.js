import { json, getList, saveList, requireAdmin, requireCustomer, getCatalog, saveCatalog } from "../_lib.js";

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
   not recorded here. Body: {items:[{id,name,price,qty}], subtotal,
   shipping, total, name, phone, address, notes, paymentMethod,
   paymentProof}. paymentMethod is one of "cash"/"vodafone"/"instapay";
   paymentProof is a compressed base64 data URL screenshot of the
   transfer, required by the client for vodafone/instapay (not enforced
   again server-side, since the client already blocks submission without
   it). notes is an optional free-text field the customer can add. */
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
    subtotal: +body.subtotal || 0,
    shipping: +body.shipping || 0,
    total: +body.total || 0,
    name: (body.name || "").trim(),
    phone: (body.phone || "").trim(),
    address: (body.address || "").trim(),
    notes: (body.notes || "").trim(),
    paymentMethod: (body.paymentMethod || "").trim(),
    paymentProof: body.paymentProof || null,
    createdAt: Date.now()
  };
  var list = await getList(env, "orders");
  list.push(order);
  await saveList(env, "orders", list);

  /* خصم الكمية المتاحة تلقائيًا لكل صنف فيه تتبع كمية مفعّل (منتج أو لون
     له رقم كمية محدد - مش null). ده بيحصل بس هنا، في مسار طلبات الموقع
     (عميل مسجّل دخول) - طلبات الواتساب للضيوف مش بتوصل للسيرفر خالص
     فمفيش خصم تلقائي ليها، وده قيد معروف في تصميم الموقع الحالي. أي خطأ
     هنا (مثلاً الكتالوج مش موجود) ما يمنعش تسجيل الطلب نفسه. */
  try{
    var catalog = await getCatalog(env);
    if(catalog){
      var changed = false;
      body.items.forEach(function(it){
        var p = catalog.products.find(function(x){ return String(x.id) === String(it.id); });
        if(!p) return;
        var colorName = String(it.colorName || "").trim();
        var qty = Math.max(0, +it.qty || 0);
        if(colorName && Array.isArray(p.colors)){
          var c = p.colors.find(function(x){ return x.name === colorName; });
          if(c && c.stock != null){ c.stock = Math.max(0, (+c.stock||0) - qty); changed = true; }
        } else if(p.stock != null){
          p.stock = Math.max(0, (+p.stock||0) - qty); changed = true;
        }
      });
      if(changed) await saveCatalog(env, catalog);
    }
  }catch(e){ /* الخصم مش أساسي لنجاح الطلب */ }

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
