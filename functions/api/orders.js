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

/* POST /api/orders - عميل مسجّل دخول أو عميل ضيف (من غير حساب) على حد
   سوا. لو معاه هيدرز عميل صحيحة (X-Customer-Id/Pass) الطلب بيترابط
   بحسابه (customerId) عشان يقدر يشوفه بعدين في "طلباتي" بفاتورته
   كاملة؛ لو من غير حساب (ضيف) الطلب برضه بيتسجّل عادي (customerId=null)
   لكن مش هيظهر لحد إلا الأدمن، وبيتبعت فورًا إشعار بالإيميل لصاحب
   المتجر عشان محدش يتأخر عليه (شوف sendGuestOrderEmail تحت). Body:
   {items:[{id,name,price,qty}], subtotal, shipping, total, name, phone,
   governorate, address, notes, paymentMethod, paymentProof}. الاسم ورقم
   الموبايل والمحافظة والعنوان إلزاميين للضيف (العميل المسجّل بياناته
   ترجع من حسابه أصلاً). paymentMethod هو "cash"/"vodafone"/"instapay"؛
   paymentProof صورة سكرين شوت التحويل base64 مضغوطة، إلزامية من الفرونت
   اند لفودافون كاش/إنستاباي (مش بتتفحص تاني هنا). notes اختياري. */
export async function onRequestPost({ request, env }){
  var customer = await requireCustomer(request, env);

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  if(!body || !Array.isArray(body.items) || !body.items.length){
    return json({ ok:false, error:"bad_request" }, 400);
  }

  var name = (body.name || "").trim();
  var phone = (body.phone || "").trim();
  var governorate = (body.governorate || "").trim();
  var address = (body.address || "").trim();
  if(!phone) return json({ ok:false, error:"missing_phone" }, 400);
  if(!customer && (!name || !governorate || !address)) return json({ ok:false, error:"missing_guest_info" }, 400);

  /* التأكد من المخزون قبل تسجيل الطلب: لو أي صنف (منتج/لون/حجم علبة) متحدد
     له كمية، والعميل طالب أكتر من الكمية المتاحة دلوقتي على السيرفر (مثلاً
     عميل تاني اشترى نفس المنتج قبله بشوية)، الطلب بيترفض ومبيتسجلش، والموقع
     بيرجّع العميل للسلة بعد ما يظبط الكمية على المتاح. */
  try{
    var stockCatalog = await getCatalog(env);
    if(stockCatalog && Array.isArray(stockCatalog.products)){
      var need = {};
      body.items.forEach(function(it){
        var key = String(it.id) + "::" + String(it.colorName || "").trim() + "::" + String(it.sizeLabel || "").trim();
        need[key] = (need[key] || 0) + Math.max(0, +it.qty || 0);
      });
      var short = [];
      Object.keys(need).forEach(function(key){
        var parts = key.split("::");
        var pid = parts[0], colorName = parts[1], sizeLabel = parts[2];
        var p = stockCatalog.products.find(function(x){ return String(x.id) === pid; });
        if(!p) return;
        var stock = null;
        if(sizeLabel && Array.isArray(p.sizes) && p.sizes.length){
          var s = p.sizes.find(function(x){ return x.label === sizeLabel; });
          stock = (s && s.stock != null) ? (+s.stock || 0) : null;
        } else if(colorName && Array.isArray(p.colors) && p.colors.length){
          var c = p.colors.find(function(x){ return x.name === colorName; });
          stock = (c && c.stock != null) ? (+c.stock || 0) : null;
        } else if(p.stock != null){
          stock = +p.stock || 0;
        }
        if(stock != null && need[key] > stock){
          short.push({ id: p.id, name: p.name, colorName: colorName || null, sizeLabel: sizeLabel || null, available: Math.max(0, stock), requested: need[key] });
        }
      });
      if(short.length) return json({ ok:false, error:"insufficient_stock", items: short }, 409);
    }
  }catch(e){ /* لو الكتالوج مش متاح لأي سبب، الطلب بيكمّل زي الأول */ }

  var order = {
    id: "ord_" + Date.now().toString(36) + Math.floor(Math.random() * 999),
    customerId: customer ? customer.identifier : null,
    customerName: customer ? customer.name : (name || "عميل زائر"),
    items: body.items,
    subtotal: +body.subtotal || 0,
    shipping: +body.shipping || 0,
    total: +body.total || 0,
    name: name,
    phone: phone,
    governorate: governorate,
    address: address,
    notes: (body.notes || "").trim(),
    paymentMethod: (body.paymentMethod || "").trim(),
    paymentProof: null,
    createdAt: Date.now()
  };

  /* سكرين شوت التحويل (فودافون كاش / إنستاباي) بيتخزن لوحده في KV
     بمفتاح "proof:<رقم الطلب>" بجودته الكاملة، بدل ما يتحط جوه قائمة
     الطلبات نفسها (كانت بتكبر وتتقل مع كل طلب). الطلب بيشيل بس علامة
     proofStored + نوع الصورة وحجمها، والأدمن بيفتحه وينزّله من
     /api/proof?id=<رقم الطلب>. لو التخزين المنفصل فشل لأي سبب بنرجع
     للطريقة القديمة (الصورة جوه الطلب) عشان الإيصال ما يضيعش. */
  var rawProof = typeof body.paymentProof === "string" ? body.paymentProof : "";
  if(rawProof){
    var stored = false;
    var pm = /^data:(image\/(?:jpeg|jpg|png|webp|gif|heic|heif));base64,([A-Za-z0-9+\/=\s]+)$/.exec(rawProof);
    if(pm){
      try{
        var ptype = pm[1] === "image/jpg" ? "image/jpeg" : pm[1];
        var pbin = atob(pm[2].replace(/\s+/g, ""));
        if(pbin.length > 0 && pbin.length <= 8 * 1024 * 1024){
          var pbytes = new Uint8Array(pbin.length);
          for(var pi = 0; pi < pbin.length; pi++) pbytes[pi] = pbin.charCodeAt(pi);
          await env.STORE_KV.put("proof:" + order.id, pbytes, { metadata: { type: ptype, size: pbytes.length, at: order.createdAt } });
          order.proofStored = true;
          order.proofType = ptype;
          order.proofSize = pbytes.length;
          stored = true;
        }
      }catch(e){ stored = false; }
    }
    if(!stored && rawProof.length <= 3 * 1024 * 1024) order.paymentProof = rawProof;
  }

  /* بنسجّل نتيجة إرسال إيميل الإشعار (نجح/فشل + كود الاستجابة) على الطلب
     نفسه (emailDebug) - مش بس بنحاول ونسكت لو فشل زي الأول. ده عشان لو
     الإيميل معاش يوصل نقدر نشوف السبب بالظبط من صفحة تفاصيل الطلب في
     لوحة التحكم من غير ما نحتاج نوصل لداشبورد Resend مباشرة. */
  /* إيميل الإشعار بيتبعت لكل الطلبات: ضيف أو عميل مسجّل (كان الأول للضيف بس). */
  try{ order.emailDebug = await sendGuestOrderEmail(order, env); }
  catch(e){ order.emailDebug = { ok:false, error: String((e && e.message) || e) }; }

  var list = await getList(env, "orders");
  list.push(order);
  await saveList(env, "orders", list);

  /* خصم الكمية المتاحة تلقائيًا لكل صنف فيه تتبع كمية مفعّل (منتج أو لون
     له رقم كمية محدد - مش null). بيحصل لكل الطلبات اللي بتوصل هنا سواء
     من عميل مسجّل أو ضيف. أي خطأ هنا (مثلاً الكتالوج مش موجود) ما يمنعش
     تسجيل الطلب نفسه. */
  try{
    var catalog = await getCatalog(env);
    if(catalog){
      var changed = false;
      body.items.forEach(function(it){
        var p = catalog.products.find(function(x){ return String(x.id) === String(it.id); });
        if(!p) return;
        var colorName = String(it.colorName || "").trim();
        var sizeLabel = String(it.sizeLabel || "").trim();
        var qty = Math.max(0, +it.qty || 0);
        /* أحجام العلب (p.sizes): كل حجم له كميته الخاصة، فبنخصم من الحجم
           اللي العميل اختاره بالظبط. */
        if(sizeLabel && Array.isArray(p.sizes) && p.sizes.length){
          var s = p.sizes.find(function(x){ return x.label === sizeLabel; });
          if(s && s.stock != null){ s.stock = Math.max(0, (+s.stock||0) - qty); changed = true; }
        } else if(colorName && Array.isArray(p.colors)){
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
   governorate, address}. Lets the store owner fix a mistake in an
   already-placed order (wrong quantity/price, a typo in the address, ...)
   without deleting and recreating it. customerId/customerName/createdAt
   are never changed. */
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
  o.governorate = (body.governorate || "").trim();
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
  /* حذف سكرين التحويل المتخزن لوحده مع الطلب */
  try{ await env.STORE_KV.delete("proof:" + id); }catch(e){}
  return json({ ok:true });
}

/* بيبعت إشعار إيميل فوري لصاحب المتجر (shady.ahmed.abdo.1987@gmail.com)
   لما عميل يعمل طلب من غير ما يسجّل حساب - ده الطلب الوحيد اللي مفيش
   وسيلة تانية صاحب المتجر يتابعه بيها غير الإيميل، لأن مفيش حساب
   مرتبط بيه يقدر يتابعه منه زي طلبات العملاء المسجّلين.
   بيستخدم Resend (استبدلنا بيه Web3Forms بعد ما تأكدنا إنه بيرد "نجاح"
   ومع ذلك الإيميل مش بيوصل فعليًا - مشكلة مش قادرين نشخصها أو نصلحها من
   عندنا). مفتاح الـ API بييجي من متغيّر بيئة على Cloudflare Pages
   (env.RESEND_API_KEY) مش مكتوب هنا في الكود، عشان الريبو ده عام على
   GitHub ومفتاح Resend أحساس من مفتاح Web3Forms القديم. لازم يتضاف يدويًا
   من Cloudflare Dashboard → Settings → Environment variables.
   من غير توثيق دومين خاص، Resend بيسمح بالإرسال بس لنفس الإيميل اللي
   اتسجل بيه الحساب - وده بالظبط إيميل صاحب المتجر فمفيش مشكلة.
   الدالة بترجع تفاصيل نتيجة الإرسال (نجح ولا فشل، وكود وجسم استجابة
   Resend) عشان تتسجل على الطلب نفسه (emailDebug) - مفيش استثناء بيتفلت
   منها، أي خطأ بيترجم لكائن {ok:false, error} بدل ما يوقف تسجيل الطلب
   (شوف onRequestPost). */
async function sendGuestOrderEmail(order, env){
  var lines = order.items.map(function(it, i){
    return (i + 1) + ") " + it.name + " ×" + it.qty + " - " + (it.price * it.qty) + " ج.م";
  });
  lines.push("الإجمالي الفرعي: " + order.subtotal + " ج.م");
  lines.push("الشحن: " + order.shipping + " ج.م");
  lines.push("الإجمالي الكلي: " + order.total + " ج.م");
  lines.push("نوع العميل: " + (order.customerId ? ("عميل مسجّل (حساب: " + order.customerId + ")") : "ضيف بدون حساب"));
  lines.push("الاسم: " + (order.name || order.customerName || "-"));
  lines.push("رقم الموبايل: " + order.phone);
  if(order.governorate) lines.push("المحافظة: " + order.governorate);
  lines.push("العنوان: " + (order.address || "-"));
  lines.push("وسيلة الدفع: " + (order.paymentMethod || "-"));
  if(order.proofStored || order.paymentProof) lines.push("سكرين شوت التحويل: مرفق - افتحه ونزّله من لوحة التحكم ← الطلبات ← فاتورة #" + String(order.id).slice(-6));
  if(order.notes) lines.push("ملاحظات: " + order.notes);

  var apiKey = env && env.RESEND_API_KEY;
  if(!apiKey){
    return { ok:false, error:"RESEND_API_KEY مش مضبوط في متغيرات البيئة على Cloudflare Pages" };
  }

  var res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + apiKey
    },
    body: JSON.stringify({
      from: "متجر آل عبده <onboarding@resend.dev>",
      to: ["shady.ahmed.abdo.1987@gmail.com"],
      subject: (order.customerId ? "طلب جديد من عميل مسجّل" : "طلب جديد بدون تسجيل") + " #" + String(order.id).slice(-6) + " - " + (+order.total || 0) + " ج.م - متجر آل عبده",
      text: lines.join("\n")
    })
  });
  var bodyText = "";
  try{ bodyText = await res.text(); }catch(e){ /* مفيش جسم استجابة نقدر نقراه */ }
  return { ok: res.ok, status: res.status, body: bodyText.slice(0, 400) };
}
