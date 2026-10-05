import { json, getList, saveList, requireAdmin, requireCustomer, getCatalog, saveCatalog } from "../_lib.js";
import { getCoupons, saveCoupons, findCoupon, couponState, usedBy, perCustomerLimit, normPhone } from "../_coupons.js";
import { dataUrlToBytes, sha256Bytes, checkReceipt, normRef } from "../_payproof.js";

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

  /* Free shipping (set per product from the admin app): the order ships free
     only when EVERY product in it has freeShipping; otherwise the normal
     shipping fee applies. Decided here, not taken from the phone.
     (keep SHIPPING_FEE equal to SHIPPING_COST in index.html) */
  var SHIPPING_FEE = 100;
  /* shipping by governorate: Alexandria 50, everywhere else SHIPPING_FEE
     (keep equal to SHIPPING_ALEX / SHIPPING_COST in index.html) */
  var SHIPPING_ALEX = 50;
  function shipFeeFor(g){ return String(g || "").trim() === "\u0627\u0644\u0625\u0633\u0643\u0646\u062F\u0631\u064A\u0629" ? SHIPPING_ALEX : SHIPPING_FEE; }
  var shipping = +body.shipping || 0;
  try{
    var shipCatalog = (typeof stockCatalog !== "undefined" && stockCatalog) ? stockCatalog : await getCatalog(env);
    if(shipCatalog && Array.isArray(shipCatalog.products)){
      var allFree = body.items.every(function(it){
        var p = shipCatalog.products.find(function(x){ return String(x.id) === String(it.id); });
        return !!(p && p.freeShipping);
      });
      shipping = allFree ? 0 : shipFeeFor(governorate || (customer && customer.governorate));
    }
  }catch(e){}
  /* ...and every order whose products total (after any discount code)
     reaches FREE_SHIP_MIN ships free too. Checked again below once the
     discount code is known. (keep equal to FREE_SHIP_MIN in index.html) */
  var FREE_SHIP_MIN = 1000;
  var clientShipping = +body.shipping || 0;

  /* كود الخصم: لازم العميل يكون مسجّل دخول، والكود فعّال ولسه ما خلصش،
     وما اتستخدمش قبل كده من نفس الحساب أو نفس رقم الموبايل أو نفس
     الإيميل. الخصم بيتحسب هنا على السيرفر (مش بنصدّق الرقم اللي جاي من
     الموبايل). */
  var coupon = null, couponList = null;
  var itemsSubtotal = body.items.reduce(function(sum, it){ return sum + (+it.price || 0) * Math.max(0, +it.qty || 0); }, 0);
  if(body.couponCode){
    if(!customer) return json({ ok:false, error:"coupon_login_required" }, 401);
    couponList = await getCoupons(env);
    coupon = findCoupon(couponList, body.couponCode);
    var cst = couponState(coupon);
    if(cst !== "ok") return json({ ok:false, error:"coupon_" + cst }, 409);
    if(usedBy(coupon, customer, phone)) return json({ ok:false, error:"coupon_used", limit: perCustomerLimit(coupon) }, 409);
  }

  var discPreview = coupon ? Math.round(itemsSubtotal * (+coupon.percent || 0) / 100) : 0;
  if(itemsSubtotal - discPreview >= FREE_SHIP_MIN) shipping = 0;

  var order = {
    id: "ord_" + Date.now().toString(36) + Math.floor(Math.random() * 999),
    customerId: customer ? customer.identifier : null,
    customerName: customer ? customer.name : (name || "عميل زائر"),
    items: body.items,
    subtotal: +body.subtotal || 0,
    shipping: shipping,
    total: Math.max(0, (+body.total || 0) - clientShipping + shipping),
    name: name,
    phone: phone,
    governorate: governorate,
    address: address,
    notes: (body.notes || "").trim(),
    paymentMethod: (body.paymentMethod || "").trim(),
    paymentProof: null,
    createdAt: Date.now()
  };

  if(coupon){
    order.subtotal = itemsSubtotal;
    order.coupon = coupon.code;
    order.couponPercent = +coupon.percent || 0;
    order.discount = Math.round(itemsSubtotal * order.couponPercent / 100);
    order.total = Math.max(0, itemsSubtotal - order.discount) + order.shipping;
  }

  /* فودافون كاش / إنستاباي: الإيصال لازم يكون اتراجع آليًا قبل كده من
     /api/verify-proof (الرقم المحوّل له هو رقم المتجر، والمبلغ يغطي
     الإجمالي، ومش مستخدم قبل كده). لو مش متراجع (مثلاً نسخة قديمة من
     الصفحة) بنراجعه هنا. "manual" = المراجعة الآلية مش متاحة دلوقتي،
     فالطلب بيتسجل وبيتعلّم إنه محتاج مراجعة يدوية من الأدمن. */
  var proofHash = null, proofRef = "";
  if(order.paymentMethod === "vodafone" || order.paymentMethod === "instapay"){
    var pimg = dataUrlToBytes(body.paymentProof);
    if(!pimg) return json({ ok:false, error:"proof_missing" }, 400);
    proofHash = await sha256Bytes(pimg.bytes);
    if(await env.STORE_KV.get("pimg:" + proofHash)) return json({ ok:false, error:"proof_reused" }, 409);
    var pv = null;
    try{ var pvRaw = await env.STORE_KV.get("pv:" + proofHash); pv = pvRaw ? JSON.parse(pvRaw) : null; }catch(e){ pv = null; }
    if(!pv) pv = await checkReceipt(env, pimg, order.total);
    if(pv.status === "fail") return json({ ok:false, error:"proof_" + (pv.reason || "invalid"), amount: pv.amount, total: order.total }, 409);
    if(pv.status === "ok" && (+pv.amount || 0) + 1 < order.total) return json({ ok:false, error:"proof_low_amount", amount: pv.amount, total: order.total }, 409);
    proofRef = normRef(pv.reference || "");
    if(proofRef.length >= 6 && await env.STORE_KV.get("pref:" + proofRef)) return json({ ok:false, error:"proof_reused" }, 409);
    order.proofCheck = {
      status: pv.status,
      amount: pv.amount != null ? pv.amount : null,
      recipient: pv.recipient || "",
      recipientName: pv.recipientName || "",
      reference: pv.reference || "",
      provider: pv.provider || "",
      date: pv.date || ""
    };
  }

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

  /* الإيصال اتستخدم خلاص: نفس الصورة أو نفس رقم العملية مش هينفعوا لطلب تاني */
  if(proofHash){
    try{
      await env.STORE_KV.put("pimg:" + proofHash, order.id);
      if(proofRef.length >= 6) await env.STORE_KV.put("pref:" + proofRef, order.id);
    }catch(e){}
  }

  if(coupon){
    try{
      var fresh = await getCoupons(env);
      var fc = findCoupon(fresh, coupon.code);
      if(fc){
        fc.uses = Array.isArray(fc.uses) ? fc.uses : [];
        fc.uses.push({ customerId: customer.identifier, phone: normPhone(phone || customer.identifier), email: String(customer.email || "").toLowerCase(), name: order.name || customer.name || "", orderId: order.id, at: order.createdAt });
        await saveCoupons(env, fresh);
      }
    }catch(e){ /* الطلب نفسه اتسجل خلاص */ }
  }

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

  return json({ ok:true, orderId: order.id, total: order.total, discount: order.discount || 0 });
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
  var oldItems = Array.isArray(o.items) ? o.items.slice() : [];
  o.items = body.items;
  o.total = +body.total || 0;
  /* the admin can change the shipping fee or make it free (0) */
  if(body.shipping != null && body.shipping !== ""){
    var shipEdit = Math.round(+body.shipping);
    if(isFinite(shipEdit) && shipEdit >= 0) o.shipping = shipEdit;
  }
  /* الطلب اللي عليه كود خصم: الخصم بيتحسب تاني على الأصناف بعد التعديل */
  var editSub = body.items.reduce(function(sum, it){ return sum + (+it.price || 0) * Math.max(0, +it.qty || 0); }, 0);
  o.subtotal = editSub;
  o.discount = o.coupon ? Math.round(editSub * (+o.couponPercent || 0) / 100) : (+o.discount || 0);
  if(!o.coupon) o.discount = 0;
  o.total = Math.max(0, editSub - o.discount) + (+o.shipping || 0);
  o.name = (body.name || "").trim();
  o.phone = (body.phone || "").trim();
  o.governorate = (body.governorate || "").trim();
  o.address = (body.address || "").trim();

  /* payment method + transfer receipt set by the admin (e.g. the customer
     paid by Vodafone Cash / InstaPay later and sent the screenshot on
     WhatsApp). The receipt is stored exactly like a customer's one. */
  var PM = { cash:1, vodafone:1, instapay:1 };
  if(body.paymentMethod && PM[body.paymentMethod]) o.paymentMethod = body.paymentMethod;
  if(body.removeProof){
    try{ await env.STORE_KV.delete("proof:" + o.id); }catch(e){}
    delete o.proofStored; delete o.proofType; delete o.proofSize; delete o.proofCheck;
    o.paymentProof = null;
  }
  if(typeof body.paymentProof === "string" && body.paymentProof){
    var am = /^data:(image\/(?:jpeg|jpg|png|webp|gif|heic|heif));base64,([A-Za-z0-9+\/=\s]+)$/.exec(body.paymentProof);
    if(!am) return json({ ok:false, error:"bad_image" }, 400);
    var atype = am[1] === "image/jpg" ? "image/jpeg" : am[1];
    var abin;
    try{ abin = atob(am[2].replace(/\s+/g, "")); }catch(e){ return json({ ok:false, error:"bad_image" }, 400); }
    if(!abin.length || abin.length > 8 * 1024 * 1024) return json({ ok:false, error:"too_big" }, 413);
    var abytes = new Uint8Array(abin.length);
    for(var ai = 0; ai < abin.length; ai++) abytes[ai] = abin.charCodeAt(ai);
    await env.STORE_KV.put("proof:" + o.id, abytes, { metadata: { type: atype, size: abytes.length, at: Date.now(), by: "admin" } });
    o.proofStored = true; o.proofType = atype; o.proofSize = abytes.length;
    o.paymentProof = null;

    /* the receipt the admin attached goes through the same AI check as a
       customer's (store number / IPA, amount vs this order's total, not
       used before, not old). The admin can still save it if it fails;
       the result is shown on the invoice. */
    var ahash = await sha256Bytes(abytes);
    var usedBy = await env.STORE_KV.get("pimg:" + ahash);
    var pvA = null;
    if(usedBy && usedBy !== o.id){
      pvA = { status: "fail", reason: "reused" };
    } else {
      try{ var pvRawA = await env.STORE_KV.get("pv:" + ahash); pvA = pvRawA ? JSON.parse(pvRawA) : null; }catch(e){ pvA = null; }
      if(pvA && pvA.status === "fail" && pvA.reason === "reused" && usedBy === o.id) pvA = null;
      if(!pvA){
        if(usedBy === o.id){ try{ await env.STORE_KV.delete("pimg:" + ahash); }catch(e){} }
        pvA = await checkReceipt(env, { bytes: abytes, type: atype }, o.total);
      }
      if(pvA.status === "ok" && (+pvA.amount || 0) + 1 < (+o.total || 0)){ pvA.status = "fail"; pvA.reason = "low_amount"; }
    }
    o.proofCheck = {
      status: pvA.status, reason: pvA.reason || null,
      amount: pvA.amount != null ? pvA.amount : null,
      recipient: pvA.recipient || "", recipientName: pvA.recipientName || "",
      reference: pvA.reference || "", provider: pvA.provider || "", date: pvA.date || "",
      total: +o.total || 0, by: "admin", at: Date.now()
    };
    if(pvA.status === "ok"){
      await env.STORE_KV.put("pimg:" + ahash, o.id);
      var aref = normRef(pvA.reference || "");
      if(aref.length >= 6) await env.STORE_KV.put("pref:" + aref, o.id);
    }
  }
  list[idx] = o;
  await saveList(env, "orders", list);
  /* المخزون: الفرق بين الأصناف قبل وبعد التعديل بيتسحب من الرصيد (صنف
     جديد أو كمية زادت) أو بيرجع للرصيد (صنف اتشال أو كمية قلّت). */
  var stock = null;
  try{ stock = await applyEditStock(env, oldItems, o.items); }catch(e){ stock = null; }
  return json({ ok:true, order:o, stock:stock });
}

/* مفتاح الصنف في المخزون: المنتج + الحجم أو اللون (نفس ترتيب الخصم وقت الطلب) */
function stockKey(it){
  if(!it || it.id == null || it.id === "") return null;
  var sz = String(it.sizeLabel || "").trim(), cl = String(it.colorName || "").trim();
  return String(it.id) + "|" + (sz ? "s:" + sz : (cl ? "c:" + cl : ""));
}
async function applyEditStock(env, oldItems, newItems){
  var delta = {}, info = {};
  function add(arr, sign){
    (arr || []).forEach(function(it){
      var k = stockKey(it); if(!k) return;
      delta[k] = (delta[k] || 0) + sign * Math.max(0, Math.round(+it.qty || 0));
      if(!info[k]) info[k] = it;
    });
  }
  add(oldItems, -1); add(newItems, +1);
  var keys = Object.keys(delta).filter(function(k){ return delta[k] !== 0; });
  if(!keys.length) return { changes:[], short:[] };
  var catalog = await getCatalog(env);
  if(!catalog || !Array.isArray(catalog.products)) return null;
  var changes = [], short = [], changed = false;
  keys.forEach(function(k){
    var it = info[k], d = delta[k];
    var p = catalog.products.find(function(x){ return String(x.id) === String(it.id); });
    if(!p) return;
    var sz = String(it.sizeLabel || "").trim(), cl = String(it.colorName || "").trim(), holder = null;
    if(sz && Array.isArray(p.sizes) && p.sizes.length) holder = p.sizes.find(function(x){ return x.label === sz; }) || null;
    else if(cl && Array.isArray(p.colors)) holder = p.colors.find(function(x){ return x.name === cl; }) || null;
    else holder = p;
    if(!holder || holder.stock == null) return;          /* الكمية مش متتبعة */
    var before = +holder.stock || 0;
    if(d > before) short.push({ id:p.id, name:p.name, sizeLabel: sz || null, colorName: cl || null, available: before, requested: d });
    holder.stock = Math.max(0, before - d);
    changed = true;
    changes.push({ id:p.id, name:p.name, sizeLabel: sz || null, colorName: cl || null, delta: -d, stock: holder.stock });
  });
  if(changed) await saveCatalog(env, catalog);
  return { changes:changes, short:short };
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
  var gone = list.find(function(o){ return o.id === id; });
  var next = list.filter(function(o){ return o.id !== id; });
  if(next.length === list.length) return json({ ok:false, error:"not_found" }, 404);
  await saveList(env, "orders", next);
  /* لو الطلب المحذوف كان عليه كود خصم، العميل يقدر يستخدم الكود تاني */
  if(gone && gone.coupon){
    try{
      var cl = await getCoupons(env);
      var cc = findCoupon(cl, gone.coupon);
      if(cc && Array.isArray(cc.uses)){
        cc.uses = cc.uses.filter(function(u){ return u.orderId !== id; });
        await saveCoupons(env, cl);
      }
    }catch(e){}
  }
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
  if(order.coupon) lines.push("كود الخصم: " + order.coupon + " (" + order.couponPercent + "%) - خصم " + order.discount + " ج.م");
  lines.push("الشحن: " + order.shipping + " ج.م");
  lines.push("الإجمالي الكلي: " + order.total + " ج.م");
  lines.push("نوع العميل: " + (order.customerId ? ("عميل مسجّل (حساب: " + order.customerId + ")") : "ضيف بدون حساب"));
  lines.push("الاسم: " + (order.name || order.customerName || "-"));
  lines.push("رقم الموبايل: " + order.phone);
  if(order.governorate) lines.push("المحافظة: " + order.governorate);
  lines.push("العنوان: " + (order.address || "-"));
  lines.push("وسيلة الدفع: " + (order.paymentMethod || "-"));
  if(order.proofCheck) lines.push("مراجعة الإيصال: " + (order.proofCheck.status === "ok" ? "✅ اتراجع آليًا" : "⚠️ محتاج مراجعة يدوية") + (order.proofCheck.amount != null ? " - المبلغ " + order.proofCheck.amount + " ج.م" : "") + (order.proofCheck.reference ? " - رقم العملية " + order.proofCheck.reference : ""));
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

/* PATCH /api/orders - admin only. Body: {id} or {all:true}. Marks an order
   (or every order) as opened by the admin, so its "new order" badge and
   phone notification go away. */
export async function onRequestPatch({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var list = await getList(env, "orders");
  var now = Date.now(), changed = 0;
  list.forEach(function(o){
    if(o.adminSeen) return;
    if((body && body.all) || (body && body.id && o.id === body.id)){ o.adminSeen = now; changed++; }
  });
  if(changed) await saveList(env, "orders", list);
  return json({ ok:true, changed: changed });
}
