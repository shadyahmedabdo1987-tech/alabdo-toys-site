/* /api/ticker — الشريط اللي بيتحرك تحت البانرات الرئيسية.
   - GET (عام): {set, items:[{id, text, color, logo, plain}]}
       set=false → لسه ماتعدلش (الموقع بيعرض الشريط الأصلي بتاع طرق الدفع).
       set=true و items فاضية → الشريط مخفي.
   - PUT (أدمن) {items}: حفظ (أقصى 12 كلمة).
   - DELETE (أدمن): رجوع للشريط الأصلي.
   color: "#rrggbb" أو "" (اللون العادي). logo: "" أو "builtin:vodafone|instapay|cash"
   أو صورة مرفوعة "/api/img?id=...". plain=true يعني كلام عادي من غير كبسولة. */
import { json, requireAdmin } from "../_lib.js";

const KEY = "ticker";
const LOGO = /^(|builtin:(vodafone|instapay|cash)|\/api\/img\?id=[a-f0-9]{16,64})$/;

export async function onRequestGet({ env }){
  let cfg = null;
  try{ cfg = JSON.parse(await env.STORE_KV.get(KEY) || "null"); }catch(e){ cfg = null; }
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
  for(const it of raw.slice(0, 12)){
    const text = String(it && it.text || "").replace(/[\u0000-\u001f<>]+/g, " ").trim().slice(0, 60);
    let color = String(it && it.color || "").trim().toLowerCase();
    if(!/^#[0-9a-f]{6}$/.test(color)) color = "";
    let logo = String(it && it.logo || "");
    if(!LOGO.test(logo)) logo = "";
    if(!text && !logo) continue;
    let id = String(it && it.id || "").replace(/[^\w-]/g, "").slice(0, 30);
    if(!id) id = "tk_" + Date.now().toString(36) + Math.floor(Math.random() * 999);
    items.push({ id, text, color, logo, plain: !!(it && it.plain) });
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
