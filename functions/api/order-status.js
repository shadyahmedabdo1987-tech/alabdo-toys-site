/* /api/order-status — تتبع الطلب.
   POST (أدمن) {id, status}: status = new | preparing | shipped | delivered | cancelled
   POST (أدمن) {id, pay:"confirm"|"reject"}: طلبات فودافون كاش / إنستاباي بتتسجل
   payPending=true (الإيصال ممكن يكون متعدل)، ومش بتتحول لـ "بيتجهز" أو "خرج
   للشحن" أو "وصل" غير بعد ما الأدمن يأكد إن الفلوس وصلت المحفظة فعلًا.
   "reject" = الفلوس ما وصلتش ← الطلب بيتلغى والعميل بيوصله إشعار.
   بيحفظ الحالة وتاريخها على الطلب (statusHistory)، وبيبعت للعميل إشعار في
   الجرس (ولو عنده التطبيق الجديد بيوصله كإشعار على الموبايل). */
import { json, getList, saveList, requireAdmin } from "../_lib.js";
import { addNote, phoneTail } from "../_notes.js";

const LABELS = {
  new:       { t:"✅ طلبك اتسجل",          m:"استلمنا طلبك وهنبدأ نجهزه في أقرب وقت." },
  preparing: { t:"📦 طلبك بيتجهز",          m:"بنجهز طلبك وبنغلّفه دلوقتي." },
  shipped:   { t:"🚚 طلبك خرج للشحن",      m:"طلبك مع المندوب وفي الطريق ليك." },
  delivered: { t:"🎉 طلبك وصل",            m:"نتمنى الألعاب تعجبكم! متنساش تقيّم المنتجات." },
  cancelled: { t:"❌ طلبك اتلغى",           m:"لو عندك أي سؤال ابعتلنا من «تواصل معنا» في التطبيق." }
};

export async function onRequestPost({ request, env }){
  const admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  const id = body && body.id, pay = String(body && body.pay || "");
  let status = String(body && body.status || "");
  if(!id || (!LABELS[status] && pay !== "confirm" && pay !== "reject")) return json({ ok:false, error:"bad_request" }, 400);
  const list = await getList(env, "orders");
  const o = list.find(function(x){ return x.id === id; });
  if(!o) return json({ ok:false, error:"not_found" }, 404);
  /* تأكيد / رفض وصول التحويل */
  if(pay === "confirm"){
    const at0 = Date.now();
    o.payPending = false;
    o.payConfirmedAt = at0;
    o.payConfirmedBy = admin.username || admin.user || "admin";
    o.updatedAt = at0;
    await saveList(env, "orders", list);
    try{
      await addNote(env, {
        type: "order", customerId: o.customerId || null, phoneTail: phoneTail(o.phone || o.customerId),
        title: "💰 وصلنا تحويلك", message: "اتأكدنا إن المبلغ وصل وهنبدأ نجهز طلبك. (فاتورة #" + String(o.id).slice(-6) + ")",
        orderId: o.id, status: o.status || "new"
      });
    }catch(e){}
    return json({ ok:true, order:o, noted:true });
  }
  if(pay === "reject"){
    o.payPending = false;
    o.payRejected = true;
    status = "cancelled";
  }
  /* الطلب ميتجهزش ولا يتشحن قبل ما الفلوس توصل */
  if(o.payPending && (status === "preparing" || status === "shipped" || status === "delivered")){
    return json({ ok:false, error:"payment_pending" }, 409);
  }
  if((o.status || "new") === status) return json({ ok:true, order:o, same:true });
  const at = Date.now();
  o.status = status;
  o.updatedAt = at;
  o.statusHistory = Array.isArray(o.statusHistory) ? o.statusHistory : [{ s:"new", at: o.createdAt || at }];
  o.statusHistory.push({ s: status, at });
  await saveList(env, "orders", list);
  try{ await env.STORE_KV.delete("insights_cache"); }catch(e){}
  let noted = false;
  if(body.notify !== false){
    try{
      const lb = o.payRejected && status === "cancelled"
        ? { t:"❌ طلبك اتلغى", m:"ما لقيناش مبلغ التحويل في حساب المتجر، فالطلب اتلغى. لو حوّلت فعلًا ابعتلنا من «تواصل معنا» برقم العملية." }
        : LABELS[status];
      await addNote(env, {
        type: "order", customerId: o.customerId || null, phoneTail: phoneTail(o.phone || o.customerId),
        title: lb.t, message: lb.m + " (" + "فاتورة #" + String(o.id).slice(-6) + ")",
        orderId: o.id, status
      });
      noted = true;
    }catch(e){}
  }
  return json({ ok:true, order:o, noted });
}
