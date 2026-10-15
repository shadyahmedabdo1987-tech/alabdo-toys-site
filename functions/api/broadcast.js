/* /api/broadcast — إشعارات العروض لكل عملاء التطبيق.
   - GET ?since=<ms>  (عام): الإشعارات اللي معادها جه بعد الوقت ده (أقصى 3)،
     تطبيق العميل بيسأل عليها كل كام ساعة وبيعرضها كإشعار على الموبايل.
     الإشعار اللي متكرر "كل يوم" بيرجع مرة كل يوم في المعاد اللي اتحدد
     (بتوقيت القاهرة) برقم مختلف لكل يوم، فالتطبيق بيعرضه كإشعار جديد.
   - GET ?all=1 (أدمن): كل الإشعارات + حالة كل واحد (آخر مرة / المرة الجاية).
   - POST (أدمن) {title, body, link, repeat:"once"|"daily", time:"HH:MM", until:"YYYY-MM-DD"|null}
   - PATCH (أدمن) {id, active?, time?, until?}: إيقاف/تشغيل التكرار أو تغيير معاده.
   - DELETE (أدمن) {id}: مسح إشعار (ولو متكرر بيبطل يتبعت خالص). */
import { json, getList, saveList, requireAdmin } from "../_lib.js";

const KEY = "broadcasts";
const LINKS = /^(home|offers|products|new|cat:[\w-]{1,40}|p:\d{1,12})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TZ = "Africa/Cairo";
const DAY = 86400000;

function clean(s, max){ return String(s || "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max); }

/* ---- توقيت القاهرة (بيراعي التوقيت الصيفي) ---- */
const DTF = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
function parts(ms){
  const o = {};
  DTF.formatToParts(new Date(ms)).forEach(function(p){ if(p.type !== "literal") o[p.type] = +p.value; });
  if(o.hour === 24) o.hour = 0;
  return o;
}
function offsetMs(ms){
  const p = parts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
/* يوم/ساعة بتوقيت القاهرة → وقت عالمي (ms) */
function cairoToMs(y, m, d, hh, mm){
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMs(guess);
  t = guess - offsetMs(t);
  return t;
}
function cairoDay(ms){ const p = parts(ms); return { y: p.year, m: p.month, d: p.day }; }
function dayKey(dd){ return dd.y + String(dd.m).padStart(2, "0") + String(dd.d).padStart(2, "0"); }
function addDays(dd, n){ const t = new Date(Date.UTC(dd.y, dd.m - 1, dd.d) + n * DAY); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
function untilFromDay(s){
  const m = DAY_RE.exec(String(s || "")); if(!m) return null;
  return cairoToMs(+m[1], +m[2], +m[3], 23, 59);
}
function isDaily(b){ return b && b.repeat === "daily" && TIME_RE.test(b.time || ""); }

/* مواعيد الإرسال اليومية لإشعار متكرر في آخر كام يوم (من غير النهارده لو معاده لسه ماجاش) */
function dailyOccurrences(b, now, backDays){
  if(!isDaily(b) || b.active === false) return [];
  const tm = TIME_RE.exec(b.time), hh = +tm[1], mm = +tm[2];
  const first = addDays(cairoDay(+b.at || now), 1); /* أول تكرار: اليوم اللي بعد يوم الإرسال */
  const today = cairoDay(now);
  const out = [];
  for(let k = backDays; k >= 0; k--){
    const dd = addDays(today, -k);
    if(dayKey(dd) < dayKey(first)) continue;
    const at = cairoToMs(dd.y, dd.m, dd.d, hh, mm);
    if(at > now) continue;
    if(b.until && at > +b.until) continue;
    if(b.editedAt && at < +b.editedAt) continue; /* بعد إيقاف/تشغيل أو تغيير المعاد منبعتش مواعيد فاتت */
    out.push({ id: b.id + "_" + dayKey(dd), title: b.title, body: b.body, link: b.link || "home", at });
  }
  return out;
}
function nextOccurrence(b, now){
  if(!isDaily(b) || b.active === false) return null;
  const tm = TIME_RE.exec(b.time), hh = +tm[1], mm = +tm[2];
  const first = addDays(cairoDay(+b.at || now), 1);
  let dd = cairoDay(now);
  if(dayKey(dd) < dayKey(first)) dd = first;
  for(let i = 0; i < 3; i++){
    const at = cairoToMs(dd.y, dd.m, dd.d, hh, mm);
    if(at > now){ return (b.until && at > +b.until) ? null : at; }
    dd = addDays(dd, 1);
  }
  return null;
}

export async function onRequestGet({ request, env }){
  const url = new URL(request.url);
  const list = await getList(env, KEY);
  const now = Date.now();
  if(url.searchParams.get("all")){
    const admin = await requireAdmin(request, env);
    if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
    const items = list.slice().reverse().map(function(b){
      const occ = dailyOccurrences(b, now, 400);
      const last = occ.length ? occ[occ.length - 1].at : (+b.at || 0);
      const next = nextOccurrence(b, now);
      const ended = isDaily(b) && b.active !== false && !next && b.until && +b.until < now;
      return Object.assign({}, b, { lastAt: last, nextAt: next, sentCount: 1 + occ.length, ended: !!ended });
    });
    return json({ ok:true, now, items });
  }
  const since = +url.searchParams.get("since") || 0;
  let items = [];
  list.forEach(function(b){
    if((+b.at || 0) > since) items.push({ id:b.id, title:b.title, body:b.body, link:b.link || "home", at:b.at });
    dailyOccurrences(b, now, 3).forEach(function(o){ if(o.at > since) items.push(o); });
  });
  items.sort(function(a, b){ return b.at - a.at; });
  items = items.slice(0, 3);
  return json({ ok:true, now, items });
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
  const repeat = body && body.repeat === "daily" ? "daily" : "once";
  const time = String(body && body.time || "");
  if(repeat === "daily" && !TIME_RE.test(time)) return json({ ok:false, error:"bad_time" }, 400);
  const until = repeat === "daily" ? untilFromDay(body && body.until) : null;
  const list = await getList(env, KEY);
  const last = list[list.length - 1];
  if(last && Date.now() - (+last.at || 0) < 60 * 1000) return json({ ok:false, error:"too_fast" }, 429);
  const item = { id: "bc_" + Date.now().toString(36) + Math.floor(Math.random() * 999), title, body: text, link, at: Date.now() };
  if(repeat === "daily"){ item.repeat = "daily"; item.time = time; item.active = true; item.until = until; }
  list.push(item);
  /* بنحتفظ بآخر 40 إشعار، والإشعارات المتكررة الشغالة مش بتتمسح لوحدها */
  const keep = list.filter(function(b, i){ return i >= list.length - 40 || (isDaily(b) && b.active !== false); });
  await saveList(env, KEY, keep);
  return json({ ok:true, item });
}

export async function onRequestPatch({ request, env }){
  const admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  const list = await getList(env, KEY);
  const b = list.find(function(x){ return x.id === (body && body.id); });
  if(!b) return json({ ok:false, error:"not_found" }, 404);
  if(!isDaily(b) && !(body && body.repeat === "daily")) return json({ ok:false, error:"not_repeating" }, 400);
  if(body.repeat === "daily" && !isDaily(b)){
    if(!TIME_RE.test(String(body.time || ""))) return json({ ok:false, error:"bad_time" }, 400);
    b.repeat = "daily"; b.active = true; b.until = null;
  }
  if(typeof body.active === "boolean") b.active = body.active;
  if(body.time != null){
    if(!TIME_RE.test(String(body.time))) return json({ ok:false, error:"bad_time" }, 400);
    b.time = String(body.time);
  }
  if(Object.prototype.hasOwnProperty.call(body, "until")) b.until = body.until ? untilFromDay(body.until) : null;
  /* أي تغيير بيبدأ يحسب من دلوقتي: منبعتش تكرار فات معاده النهارده */
  b.editedAt = Date.now();
  await saveList(env, KEY, list);
  return json({ ok:true, item: Object.assign({}, b, { nextAt: nextOccurrence(b, Date.now()) }) });
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
