/* /api/promo — إعلان الشاشة الرئيسية (صورة عليها عرض) اللي بيظهر للعميل أول
   ما يفتح المتجر، ويقدر يقفله.
   - GET (عام): الإعلان الحالي لو لسه شغال، أو promo:null.
   - POST (أدمن) {image, link, days}: إعلان جديد (الصورة لينك من /api/img).
   - DELETE (أدمن): وقف الإعلان. */
import { json, requireAdmin } from "../_lib.js";

const KEY = "home_promo";
const LINKS = /^(home|offers|products|new|cat:[\w-]{1,40}|p:\d{1,12}|none)$/;

async function current(env){
  let p = null;
  try{ p = JSON.parse(await env.STORE_KV.get(KEY) || "null"); }catch(e){ p = null; }
  return p;
}

export async function onRequestGet({ request, env }){
  const p = await current(env);
  const active = !!(p && p.image && (!p.until || p.until > Date.now()));
  const url = new URL(request.url);
  if(url.searchParams.get("admin")){
    const admin = await requireAdmin(request, env);
    if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
    return json({ ok:true, promo: p, active });
  }
  return json({ ok:true, promo: active ? { id:p.id, image:p.image, link:p.link || "none", until:p.until || 0 } : null });
}

export async function onRequestPost({ request, env }){
  const admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  const image = String(body && body.image || "");
  if(!/^\/api\/img\?id=[a-f0-9]{16,64}$/.test(image)) return json({ ok:false, error:"bad_image" }, 400);
  let link = String(body && body.link || "none");
  if(!LINKS.test(link)) link = "none";
  const days = Math.max(0, Math.min(90, Math.round(+body.days || 0)));
  const p = { id: "pr_" + Date.now().toString(36), image, link, at: Date.now(), until: days ? Date.now() + days * 86400000 : 0 };
  await env.STORE_KV.put(KEY, JSON.stringify(p));
  return json({ ok:true, promo: p });
}

export async function onRequestDelete({ request, env }){
  const admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  await env.STORE_KV.delete(KEY);
  return json({ ok:true });
}
