/* خصم قيمة الطلب: الأدمن بيحدد مستويات (لو قيمة المنتجات في الطلب وصلت رقم
   معيّن ياخد خصم معيّن - نسبة % أو مبلغ ثابت - على الطلب ده، وبياخد أعلى
   مستوى وصله بس). الحسبة كلها هنا على السيرفر. */
export const TIERS_KEY = "spend_tiers";

export function cleanTier(t){
  if(!t) return null;
  const min = Math.round(+t.min || 0);
  const type = t.type === "fixed" ? "fixed" : "percent";
  let value = +t.value || 0;
  value = type === "percent" ? Math.round(Math.min(90, Math.max(0, value)) * 10) / 10 : Math.round(Math.max(0, Math.min(1000000, value)));
  if(!(min > 0) || !(value > 0)) return null;
  const id = String(t.id || "").replace(/[^\w-]/g, "").slice(0, 30) || ("tr_" + Date.now().toString(36) + Math.floor(Math.random() * 999));
  return { id, min, type, value, active: t.active !== false };
}

export async function getTierConfig(env){
  let cfg = null;
  try{ cfg = JSON.parse(await env.STORE_KV.get(TIERS_KEY) || "null"); }catch(e){ cfg = null; }
  if(!cfg || !Array.isArray(cfg.tiers)) return { enabled:false, tiers:[] };
  return { enabled: cfg.enabled !== false, tiers: cfg.tiers.map(cleanTier).filter(Boolean), at: cfg.at || 0 };
}

/* المستويات الشغالة بس (الخصم كله متفعّل + المستوى نفسه متفعّل)، من الأصغر للأكبر */
export function activeTiers(cfg){
  if(!cfg || !cfg.enabled) return [];
  return cfg.tiers.filter(function(t){ return t.active; }).sort(function(a, b){ return a.min - b.min; });
}

/* إجمالي مشتريات العميل = اللي دفعه في المنتجات (من غير الشحن) في كل
   طلباته المسجّلة. الطلبات اللي الأدمن مسحها مش بتتحسب. */
export function customerSpend(orders, customerId){
  if(!customerId) return 0;
  return (orders || []).reduce(function(s, o){
    if(!o || o.customerId !== customerId) return s;
    return s + Math.max(0, (+o.total || 0) - (+o.shipping || 0));
  }, 0);
}

/* أعلى مستوى العميل وصله */
export function pickTier(tiers, spend){
  let best = null;
  (tiers || []).forEach(function(t){ if(spend >= t.min && (!best || t.min > best.min)) best = t; });
  return best;
}
export function nextTier(tiers, spend){
  return (tiers || []).filter(function(t){ return t.min > spend; }).sort(function(a, b){ return a.min - b.min; })[0] || null;
}

export function tierAmount(tier, subtotal){
  subtotal = Math.max(0, +subtotal || 0);
  if(!tier || !subtotal) return 0;
  if(tier.type === "fixed") return Math.min(subtotal, Math.round(+tier.value || 0));
  return Math.round(subtotal * (+tier.value || 0) / 100);
}
