/* /api/broadcast — إشعارات العروض لكل عملاء التطبيق.
   - GET ?since=<ms>  (عام): الإشعارات اللي معادها جه بعد الوقت ده (أقصى 3)،
     تطبيق العميل بيسأل عليها كل كام ساعة وبيعرضها كإشعار على الموبايل.
     الإشعار اللي متكرر "كل يوم" بيرجع مرة كل يوم في المعاد اللي اتحدد
     (بتوقيت القاهرة) برقم مختلف لكل يوم، فالتطبيق بيعرضه كإشعار جديد.
   - GET ?all=1 (أدمن): كل الإشعارات + حالة كل واحد (آخر مرة / المرة الجاية).
   - POST (أدمن) {title, body, link, repeat:"once"|"daily", time:"HH:MM", until:"YYYY-MM-DD"|null,
                  sendDate:"YYYY-MM-DD", sendTime:"HH:MM"}
       once من غير sendDate/sendTime = يتبعت فورًا. once + sendDate/sendTime = يتبعت
       في المعاد ده بس (بتوقيت القاهرة) ومش بيظهر لأي عميل قبله. daily = بيتبعت
       أول مرة في المعاد (النهارده لو لسه ماجاش، أو بكرة) وبعد كده كل يوم.
   - PATCH (أدمن) {id, active?, time?, until?}: إيقاف/تشغيل التكرار أو تغيير معاده.
   - DELETE (أدمن) {id}: مسح إشعار (ولو متكرر بيبطل يتبعت خالص). */
import { json, getList, saveList, requireAdmin } from "../_lib.js";
import { pushConfigured, sendTopic } from "../_push.js";

const KEY = "broadcasts";
const LINKS = /^(home|offers|products|new|cat:[\w-]{1,40}|p:\d{1,15})$/;
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
/* الإشعار الأساسي نفسه (مش التكرار): بيوصل بس لو معاده جه، ولو كان "كل يوم" جديد
   (noBase) مفيش إرسال أساسي خالص - أول إرسال هو أول ميعاد */
function baseDue(b, now){ return !!b && !b.noBase && (+b.at || 0) <= now; }
/* أول يوم ممكن يتبعت فيه التكرار */
function firstDay(b, now){ return b.noBase ? cairoDay(+b.at || now) : addDays(cairoDay(+b.at || now), 1); }

/* مواعيد الإرسال اليومية لإشعار متكرر في آخر كام يوم (من غير النهارده لو معاده لسه ماجاش) */
function dailyOccurrences(b, now, backDays){
  if(!isDaily(b) || b.active === false) return [];
  const tm = TIME_RE.exec(b.time), hh = +tm[1], mm = +tm[2];
  const first = firstDay(b, now); /* أول تكرار: اليوم اللي بعد يوم الإرسال (أو نفس اليوم لو "كل يوم" جديد) */
  const today = cairoDay(now);
  const out = [];
  for(let k = backDays; k >= 0; k--){
    const dd = addDays(today, -k);
    if(dayKey(dd) < dayKey(first)) continue;
    const at = cairoToMs(dd.y, dd.m, dd.d, hh, mm);
    if(at > now) continue;
    if(b.noBase && at < (+b.at || 0)) continue; /* معاد فات قبل ما الإشعار يتعمل */
    if(b.until && at > +b.until) continue;
    if(b.editedAt && at < +b.editedAt) continue; /* بعد إيقاف/تشغيل أو تغيير المعاد منبعتش مواعيد فاتت */
    out.push({ id: b.id + "_" + dayKey(dd), title: b.title, body: b.body, link: b.link || "home", at });
  }
  return out;
}
function nextOccurrence(b, now){
  if(!isDaily(b) || b.active === false) return null;
  const tm = TIME_RE.exec(b.time), hh = +tm[1], mm = +tm[2];
  const first = firstDay(b, now);
  let dd = cairoDay(now);
  if(dayKey(dd) < dayKey(first)) dd = first;
  for(let i = 0; i < 3; i++){
    const at = cairoToMs(dd.y, dd.m, dd.d, hh, mm);
    if(at > now && !(b.noBase && at < (+b.at || 0))){ return (b.until && at > +b.until) ? null : at; }
    dd = addDays(dd, 1);
  }
  return null;
}

/* ---- إشعار فوري بالعرض (تطبيق 2.0.25 وبعد كده مشترك في "offers") ----
   العرض اللي بيتبعت مرة واحدة بيتبعت فوري أول ما تدوس إرسال. المتكرر كل يوم
   بيتبعت أول ما ميعاده ييجي: السيرفر بيبص عليه مع أي طلب من التطبيقات
   (فحص العروض/الإشعارات)، وبيعلّم كل ميعاد اتبعت عشان ميتبعتش مرتين.
   التطبيقات الأقدم بتفضل تاخد العروض بالفحص الدوري زي ما هي. */
async function pushOffer(env, o){
  const key = "bcp:" + o.id;
  try{ if(await env.STORE_KV.get(key)) return false; }catch(e){ return false; }
  try{ await env.STORE_KV.put(key, "1", { expirationTtl: 60 * 60 * 24 * 8 }); }catch(e){ return false; }
  const r = await sendTopic(env, "offers", { id: o.id, kind: "offer", title: o.title, body: o.body, link: o.link || "home", at: String(o.at) });
  return r.ok;
}
export async function pushDueOffers(env){
  if(!pushConfigured(env)) return;
  const list = await getList(env, KEY);
  const now = Date.now();
  let sent = 0;
  for(const b of list){
    /* إشعار مرة واحدة متجدول: يتبعت أول ما معاده ييجي */
    if(!isDaily(b) && b.scheduled && baseDue(b, now) && +b.at >= now - 3 * 3600000){
      if(sent >= 3) return;
      if(await pushOffer(env, { id: b.id, title: b.title, body: b.body, link: b.link || "home", at: b.at })) sent++;
      continue;
    }
    if(!isDaily(b) || b.active === false) continue;
    for(const o of dailyOccurrences(b, now, 0)){
      if(o.at < now - 3 * 3600000) continue; /* ميعاد فات من بدري: ميتبعتش متأخر */
      if(sent >= 3) return;
      if(await pushOffer(env, o)) sent++;
    }
  }
}

export async function onRequestGet({ request, env, waitUntil }){
  try{ if(waitUntil) waitUntil(pushDueOffers(env).catch(function(){})); }catch(e){}
  const url = new URL(request.url);
  const list = await getList(env, KEY);
  const now = Date.now();
  if(url.searchParams.get("all")){
    const admin = await requireAdmin(request, env);
    if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
    const items = list.slice().reverse().map(function(b){
      const occ = dailyOccurrences(b, now, 400);
      const base = baseDue(b, now);
      const last = occ.length ? occ[occ.length - 1].at : (base ? (+b.at || 0) : 0);
      const next = isDaily(b) ? nextOccurrence(b, now) : (b.noBase || base ? null : +b.at);
      const ended = isDaily(b) && b.active !== false && !next && b.until && +b.until < now;
      return Object.assign({}, b, { lastAt: last, nextAt: next, sentCount: (base ? 1 : 0) + occ.length, pending: !isDaily(b) && !base, ended: !!ended });
    });
    return json({ ok:true, now, items });
  }
  const since = +url.searchParams.get("since") || 0;
  let items = [];
  list.forEach(function(b){
    if((+b.at || 0) > since && baseDue(b, now)) items.push({ id:b.id, title:b.title, body:b.body, link:b.link || "home", at:b.at });
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
  /* إرسال في معاد معيّن (مرة واحدة) */
  let sendAt = 0;
  if(repeat === "once" && body && (body.sendDate || body.sendTime)){
    const dm = DAY_RE.exec(String(body.sendDate || "")), tm2 = TIME_RE.exec(String(body.sendTime || ""));
    if(!dm || !tm2) return json({ ok:false, error:"bad_time" }, 400);
    sendAt = cairoToMs(+dm[1], +dm[2], +dm[3], +tm2[1], +tm2[2]);
    if(sendAt < Date.now() + 30 * 1000) return json({ ok:false, error:"past_time" }, 400);
    if(sendAt > Date.now() + 60 * DAY) return json({ ok:false, error:"too_far" }, 400);
  }
  const list = await getList(env, KEY);
  const last = list[list.length - 1];
  if(last && Date.now() - (+last.created || +last.at || 0) < 60 * 1000) return json({ ok:false, error:"too_fast" }, 429);
  const now0 = Date.now();
  const item = { id: "bc_" + now0.toString(36) + Math.floor(Math.random() * 999), title, body: text, link, at: sendAt || now0, created: now0 };
  if(sendAt) item.scheduled = true;
  /* "كل يوم": أول إرسال في أول ميعاد جاي، مش دلوقتي */
  if(repeat === "daily"){ item.repeat = "daily"; item.time = time; item.active = true; item.until = until; item.noBase = true; }
  list.push(item);
  /* بنحتفظ بآخر 40 إشعار، والإشعارات المتكررة الشغالة مش بتتمسح لوحدها */
  const keep = list.filter(function(b, i){ return i >= list.length - 40 || (isDaily(b) && b.active !== false) || (+b.at || 0) > now0; });
  await saveList(env, KEY, keep);
  /* "دلوقتي فورًا" بس اللي بيتبعت حالًا لكل الموبايلات (لو Firebase متظبط) */
  let pushed = false;
  if(!item.scheduled && !item.noBase){ try{ if(pushConfigured(env)) pushed = await pushOffer(env, item); }catch(e){} }
  return json({ ok:true, item, pushed, nextAt: item.noBase ? nextOccurrence(item, now0) : (item.scheduled ? item.at : null) });
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
