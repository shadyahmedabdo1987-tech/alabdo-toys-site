/* /api/banners — بانرات الخصم اللي في الصفحة الرئيسية (الموقع والتطبيق).
   - GET (عام): {set, items:[{id, image, link}]}
       set=false  → لسه ماتعدلتش، الموقع بيعرض البانرات الأصلية.
       set=true و items فاضية → القسم مخفي خالص.
   - PUT (أدمن) {items}: حفظ البانرات بالترتيب (أقصى 10).
   - DELETE (أدمن): رجوع للبانرات الأصلية. */
import { json, requireAdmin } from "../_lib.js";

const KEY = "discount_banners";
const LINKS = /^(home|offers|products|new|cat:[\w-]{1,40}|p:\d{1,12}|none)$/;
const IMG = /^(\/api\/img\?id=[a-f0-9]{16,64}|discount-(10|15)\.jpg)$/;

async function load(env){
  try{ return JSON.parse(await env.STORE_KV.get(KEY) || "null"); }catch(e){ return null; }
}

export async function onRequestGet({ env }){
  const cfg = await load(env);
  if(!cfg || !Array.isArray(cfg.items)) return json({ ok:true, set:false, items:[] });
  return json({ ok:true, set:true, items: cfg.items, at: cfg.at || 0 });
}

export async function onRequestPut({ request, env }){
  const admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  const raw = Array.isArray(body && body.items) ? body.items : null;
  if(!raw) return json({ ok:false, error:"bad_items" }, 400);
  const items = [];
  for(const it of raw.slice(0, 10)){
    const image = String(it && it.image || "");
    if(!IMG.test(image)) return json({ ok:false, error:"bad_image" }, 400);
    let link = String(it && it.link || "none");
    if(!LINKS.test(link)) link = "none";
    let id = String(it && it.id || "").replace(/[^\w-]/g, "").slice(0, 30);
    if(!id) id = "bn_" + Date.now().toString(36) + Math.floor(Math.random() * 999);
    items.push({ id, image, link });
  }
  const cfg = { items, at: Date.now() };
  await env.STORE_KV.put(KEY, JSON.stringify(cfg));
  return json({ ok:true, set:true, items, at: cfg.at });
}

export async function onRequestDelete({ request, env }){
  const admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  await env.STORE_KV.delete(KEY);
  return json({ ok:true, set:false, items:[] });
}
