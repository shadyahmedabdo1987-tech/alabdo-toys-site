/* /api/insights — أرقام مجمّعة من الطلبات (من غير أي بيانات عملاء) عشان
   صفوف "الأكثر مبيعًا" و"العملاء اشتروا كمان" في الموقع والتطبيق.
   GET (عام): {sold:{productId:qty}, also:{productId:[productId,...]}}
   بيتحسب من طلبات آخر 120 يوم، والنتيجة بتتخزن 10 دقايق. */
import { json, getList } from "../_lib.js";

const DAY = 86400000;

export async function onRequestGet({ env }){
  try{
    const cached = JSON.parse(await env.STORE_KV.get("insights_cache") || "null");
    if(cached && cached.at && Date.now() - cached.at < 10 * 60 * 1000) return json(Object.assign({ ok:true }, cached.data));
  }catch(e){}
  const orders = await getList(env, "orders");
  const since = Date.now() - 120 * DAY;
  const sold = {}, pairs = {};
  orders.forEach(function(o){
    if(!o || (+o.createdAt || 0) < since || o.status === "cancelled") return;
    const ids = [];
    (o.items || []).forEach(function(it){
      if(it.id == null) return;
      const k = String(it.id);
      sold[k] = (sold[k] || 0) + Math.max(0, +it.qty || 0);
      if(ids.indexOf(k) === -1) ids.push(k);
    });
    ids.forEach(function(a){
      ids.forEach(function(b){
        if(a === b) return;
        pairs[a] = pairs[a] || {};
        pairs[a][b] = (pairs[a][b] || 0) + 1;
      });
    });
  });
  const also = {};
  Object.keys(pairs).forEach(function(a){
    also[a] = Object.keys(pairs[a]).sort(function(x, y){ return pairs[a][y] - pairs[a][x]; }).slice(0, 8);
  });
  const data = { sold, also };
  try{ await env.STORE_KV.put("insights_cache", JSON.stringify({ at: Date.now(), data })); }catch(e){}
  return json(Object.assign({ ok:true }, data));
}
