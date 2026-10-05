/* /api/broadcast — إشعارات العروض لكل عملاء التطبيق.
   - GET ?since=<ms>  (عام): آخر الإشعارات اللي اتبعتت بعد الوقت ده (أقصى 3)،
     تطبيق العميل بيسأل عليها كل كام ساعة وبيعرضها كإشعار على الموبايل.
   - GET ?all=1 (أدمن): كل الإشعارات اللي اتبعتت.
   - POST (أدمن) {title, body, link}: إشعار جديد.
   - DELETE (أدمن) {id}: مسح إشعار (لو لسه موبايلات ماسألتش عليه مش هيوصلها). */
import { json, getList, saveList, requireAdmin } from "../_lib.js";

const KEY = "broadcasts";
const LINKS = /^(home|offers|products|new|cat:[\w-]{1,40}|p:\d{1,12})$/;

function clean(s, max){ return String(s || "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max); }

export async function onRequestGet({ request, env }){
  const url = new URL(request.url);
  const list = await getList(env, KEY);
  if(url.searchParams.get("all")){
    const admin = await requireAdmin(request, env);
    if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
    return json({ ok:true, items: list.slice().reverse() });
  }
  const since = +url.searchParams.get("since") || 0;
  const items = list.filter(function(b){ return (+b.at || 0) > since; }).slice(-3).reverse()
    .map(function(b){ return { id:b.id, title:b.title, body:b.body, link:b.link || "home", at:b.at }; });
  return json({ ok:true, now: Date.now(), items });
}

export async function onRequestPost({ request, env }){
  const admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  const title = clean(body && body.title, 70), text = clean(body && body.body, 220);
  let link = clean(body && body.link, 60) || "home";
  if(!LINKS.test(link)) link = "home";
  if(title.length < 2 || text.length < 2) return json({ ok:false, error:"missing_text" }, 400);
  const list = await getList(env, KEY);
  const last = list[list.length - 1];
  if(last && Date.now() - (+last.at || 0) < 60 * 1000) return json({ ok:false, error:"too_fast" }, 429);
  const item = { id: "bc_" + Date.now().toString(36) + Math.floor(Math.random() * 999), title, body: text, link, at: Date.now() };
  list.push(item);
  await saveList(env, KEY, list.slice(-40));
  return json({ ok:true, item });
}

export async function onRequestDelete({ request, env }){
  const admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  const id = body && body.id;
  const list = await getList(env, KEY);
  const next = list.filter(function(b){ return b.id !== id; });
  if(next.length === list.length) return json({ ok:false, error:"not_found" }, 404);
  await saveList(env, KEY, next);
  return json({ ok:true });
}
