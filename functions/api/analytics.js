import { json, getAnalytics, saveAnalytics, requireAdmin } from "../_lib.js";

var ALLOWED_VIEWS = ["home", "products", "about", "contact", "terms", "privacy"];
var ALLOWED_EVENTS = ["addToCart", "orderPlaced"];
var RETENTION_DAYS = 90;

function todayKey(){ return new Date().toISOString().slice(0, 10); }

/* بيرجّع مصفوفة تواريخ (YYYY-MM-DD) لآخر n يوم شاملة النهاردة، من الأقدم للأحدث. */
function lastNDates(n){
  var out = [];
  var now = Date.now();
  for(var i = n - 1; i >= 0; i--){
    out.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

function pruneOldDays(data){
  var keys = Object.keys(data.days).sort();
  while(keys.length > RETENTION_DAYS){
    delete data.days[keys.shift()];
  }
}

/* POST /api/analytics - عام، من غير تسجيل دخول (بيتنادى من كل زائر عادي في
   الموقع). Body: {visitorId, view} لتسجيل زيارة صفحة، أو {visitorId, event}
   لتسجيل تفاعل (إضافة للسلة / إتمام طلب). ممكن الاتنين مع بعض. */
export async function onRequestPost({ request, env }){
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }

  var visitorId = String((body && body.visitorId) || "").trim().slice(0, 40);
  if(!visitorId) return json({ ok:false, error:"missing_visitor" }, 400);

  var view = (body && body.view && ALLOWED_VIEWS.indexOf(body.view) !== -1) ? body.view : null;
  var device = (body && (body.device === "mobile" || body.device === "desktop")) ? body.device : null;
  var eventName = (body && ALLOWED_EVENTS.indexOf(body.event) !== -1) ? body.event : null;
  if(!view && !eventName) return json({ ok:false, error:"bad_request" }, 400);

  var data = await getAnalytics(env);
  var date = todayKey();
  if(!data.days[date]){
    data.days[date] = { views:0, visitors:[], pages:{}, devices:{ mobile:0, desktop:0 }, events:{ addToCart:0, orderPlaced:0 } };
  }
  var day = data.days[date];

  if(view){
    data.totalViews = (data.totalViews || 0) + 1;
    if(data.visitors.indexOf(visitorId) === -1) data.visitors.push(visitorId);
    day.views = (day.views || 0) + 1;
    if(day.visitors.indexOf(visitorId) === -1) day.visitors.push(visitorId);
    day.pages[view] = (day.pages[view] || 0) + 1;
    if(device) day.devices[device] = (day.devices[device] || 0) + 1;
  }
  if(eventName){
    day.events[eventName] = (day.events[eventName] || 0) + 1;
  }

  pruneOldDays(data);
  await saveAnalytics(env, data);
  return json({ ok:true });
}

/* GET /api/analytics - أدمن بس. بيرجّع ملخص جاهز للعرض في تاب "تحليل الزوار"
   (إجمالي، النهاردة/آخر أسبوع/آخر شهر، رسم بياني لآخر 30 يوم، أكتر الصفحات
   زيارة، ونسبة الأجهزة) - كله محسوب هنا عشان الواجهة تعرضه على طول من غير
   منطق تجميع في الفرونت اند. */
export async function onRequestGet({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);

  var data = await getAnalytics(env);
  var days = data.days || {};

  function sumRange(dateList){
    var views = 0;
    var seen = {};
    dateList.forEach(function(d){
      var day = days[d];
      if(!day) return;
      views += day.views || 0;
      (day.visitors || []).forEach(function(v){ seen[v] = 1; });
    });
    return { views: views, visitors: Object.keys(seen).length };
  }

  var last30Dates = lastNDates(30);
  var today = sumRange([todayKey()]);
  var last7 = sumRange(lastNDates(7));
  var last30 = sumRange(last30Dates);

  var events = { addToCart: 0, orderPlaced: 0 };
  var pages = {};
  var devices = { mobile: 0, desktop: 0 };
  last30Dates.forEach(function(d){
    var day = days[d];
    if(!day) return;
    events.addToCart += (day.events && day.events.addToCart) || 0;
    events.orderPlaced += (day.events && day.events.orderPlaced) || 0;
    Object.keys(day.pages || {}).forEach(function(p){ pages[p] = (pages[p] || 0) + day.pages[p]; });
    devices.mobile += (day.devices && day.devices.mobile) || 0;
    devices.desktop += (day.devices && day.devices.desktop) || 0;
  });

  var topPages = Object.keys(pages)
    .map(function(k){ return { view: k, count: pages[k] }; })
    .sort(function(a, b){ return b.count - a.count; })
    .slice(0, 6);

  var chart = last30Dates.map(function(d){
    var day = days[d];
    return { date: d, views: day ? (day.views || 0) : 0, visitors: day ? (day.visitors || []).length : 0 };
  });

  return json({
    ok: true,
    totalViews: data.totalViews || 0,
    totalVisitors: (data.visitors || []).length,
    today: today,
    last7: last7,
    last30: last30,
    events: events,
    topPages: topPages,
    devices: devices,
    chart: chart
  });
}
