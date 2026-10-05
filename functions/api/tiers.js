/* /api/tiers — خصم المشتريات (حسب إجمالي مشتريات العميل).
   - GET (عام): المستويات الشغالة {enabled, tiers:[{min,type,value}]}
   - GET ?me=1 (عميل مسجّل): {spend, tier, next} — إجمالي مشترياته والخصم اللي
     ليه دلوقتي والمستوى اللي بعده.
   - GET ?admin=1 (أدمن): كل المستويات (حتى الموقفة) + عدد العملاء اللي
     وصلوا كل مستوى.
   - PUT (أدمن) {enabled, tiers:[{id,min,type,value,active}]}: حفظ. */
import { json, getList, requireAdmin, requireCustomer } from "../_lib.js";
import { TIERS_KEY, cleanTier, getTierConfig, activeTiers, customerSpend, pickTier, nextTier } from "../_tiers.js";

function pub(t){ return t ? { id:t.id, min:t.min, type:t.type, value:t.value } : null; }

export async function onRequestGet({ request, env }){
  const url = new URL(request.url);
  const cfg = await getTierConfig(env);
  if(url.searchParams.get("admin")){
    const admin = await requireAdmin(request, env);
    if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
    const orders = await getList(env, "orders");
    const spends = {};
    orders.forEach(function(o){ if(o && o.customerId) spends[o.customerId] = (spends[o.customerId] || 0) + Math.max(0, (+o.total || 0) - (+o.shipping || 0)); });
    const values = Object.keys(spends).map(function(k){ return spends[k]; });
    const counts = {};
    cfg.tiers.forEach(function(t){ counts[t.id] = values.filter(function(v){ return v >= t.min; }).length; });
    return json({ ok:true, enabled: cfg.enabled, tiers: cfg.tiers, counts, customers: values.length });
  }
  const act = activeTiers(cfg);
  if(url.searchParams.get("me")){
    const customer = await requireCustomer(request, env);
    if(!customer) return json({ ok:false, error:"unauthorized" }, 401);
    if(!act.length) return json({ ok:true, enabled:false, spend:0, tier:null, next:null });
    const spend = customerSpend(await getList(env, "orders"), customer.identifier);
    return json({ ok:true, enabled:true, spend, tier: pub(pickTier(act, spend)), next: pub(nextTier(act, spend)) });
  }
  return json({ ok:true, enabled: act.length > 0, tiers: act.map(pub) });
}

export async function onRequestPut({ request, env }){
  const admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  const raw = Array.isArray(body && body.tiers) ? body.tiers : null;
  if(!raw) return json({ ok:false, error:"bad_tiers" }, 400);
  const tiers = raw.slice(0, 20).map(cleanTier);
  if(tiers.some(function(t){ return !t; })) return json({ ok:false, error:"bad_tier" }, 400);
  const mins = {};
  for(const t of tiers){ if(mins[t.min]) return json({ ok:false, error:"dup_min", min:t.min }, 400); mins[t.min] = 1; }
  tiers.sort(function(a, b){ return a.min - b.min; });
  const cfg = { enabled: body.enabled !== false, tiers, at: Date.now() };
  await env.STORE_KV.put(TIERS_KEY, JSON.stringify(cfg));
  return json({ ok:true, enabled: cfg.enabled, tiers });
}
