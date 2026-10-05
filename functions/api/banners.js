/* /api/banners — بانرات الصفحة الرئيسية (الموقع والتطبيق).
   ?slot=hero      → البانرات الرئيسية الكبيرة اللي في أول الصفحة.
   ?slot=discount  → بانرات الخصم (ده الافتراضي لو مفيش slot).
   - GET (عام): {slot, set, items:[{id, image, link}]}
       set=false  → لسه ماتعدلتش، الموقع بيعرض البانرات الأصلية.
       set=true و items فاضية → البانرات مخفية خالص.
   - PUT (أدمن) {items}: حفظ البانرات بالترتيب (أقصى 10).
   - DELETE (أدمن): رجوع للبانرات الأصلية. */
import { json, requireAdmin } from "../_lib.js";

const SLOTS = {
  discount: { key: "discount_banners", defaults: /^discount-(10|15)\.jpg$/ },
  hero:     { key: "hero_banners",     defaults: /^hero-banner-(3|4)\.jpg$/ }
};
const LINKS = /^(home|offers|products|new|cat:[\w-]{1,40}|p:\d{1,12}|none)$/;
const UPLOADED = /^\/api\/img\?id=[a-f0-9]{16,64}$/;

function slotOf(request){
  const s = new URL(request.url).searchParams.get("slot") || "discount";
  return SLOTS[s] ? s : null;
}
async function load(env, key){
  try{ return JSON.parse(await env.STORE_KV.get(key) || "null"); }catch(e){ return null; }
}

export async function onRequestGet({ request, env }){
  const slot = slotOf(request);
  if(!slot) return json({ ok:false, error:"bad_slot" }, 400);
  const cfg = await load(env, SLOTS[slot].key);
  if(!cfg || !Array.isArray(cfg.items)) return json({ ok:true, slot, set:false, items:[] });
  return json({ ok:true, slot, set:true, items: cfg.items, at: cfg.at || 0 });
}

export async function onRequestPut({ request, env }){
  const admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  const slot = slotOf(request);
  if(!slot) return json({ ok:false, error:"bad_slot" }, 400);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  const raw = Array.isArray(body && body.items) ? body.items : null;
  if(!raw) return json({ ok:false, error:"bad_items" }, 400);
  const items = [];
  for(const it of raw.slice(0, 10)){
    const image = String(it && it.image || "");
    if(!UPLOADED.test(image) && !SLOTS[slot].defaults.test(image)) return json({ ok:false, error:"bad_image" }, 400);
    let link = String(it && it.link || "none");
    if(!LINKS.test(link)) link = "none";
    let id = String(it && it.id || "").replace(/[^\w-]/g, "").slice(0, 30);
    if(!id) id = "bn_" + Date.now().toString(36) + Math.floor(Math.random() * 999);
    items.push({ id, image, link });
  }
  const cfg = { items, at: Date.now() };
  await env.STORE_KV.put(SLOTS[slot].key, JSON.stringify(cfg));
  return json({ ok:true, slot, set:true, items, at: cfg.at });
}

export async function onRequestDelete({ request, env }){
  const admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  const slot = slotOf(request);
  if(!slot) return json({ ok:false, error:"bad_slot" }, 400);
  await env.STORE_KV.delete(SLOTS[slot].key);
  return json({ ok:true, slot, set:false, items:[] });
}
