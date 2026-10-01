import { json, getList, saveList, requireAdmin, requireCustomer } from "../_lib.js";
import { addNote, phoneTail, hasAccountFor } from "../_notes.js";

/* GET /api/inquiries - admin only. Returns every "تواصل معنا" message
   customers have submitted through the contact-us form, so the admin
   dashboard can list them in a dedicated "استفسارات العملاء" page. */
export async function onRequestGet({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var list = await getList(env, "inquiries");
  return json({ ok:true, inquiries: list });
}

/* POST /api/inquiries - public, no login required (same spirit as the
   stock-notify requests - a browsing customer shouldn't need an account
   just to send a question). Body: {name, phone, message}. phone and
   message are required. */
export async function onRequestPost({ request, env }){
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var name = (body && body.name || "").trim();
  var phone = (body && body.phone || "").trim();
  var message = (body && body.message || "").trim();
  if(!phone || !message){ return json({ ok:false, error:"bad_request" }, 400); }

  var cust = request.headers.get("X-Customer-Id") ? await requireCustomer(request, env) : null;
  var item = {
    id: "inq_" + Date.now().toString(36) + Math.floor(Math.random() * 999),
    name: name,
    phone: phone,
    customerId: cust ? cust.identifier : null,
    message: message,
    createdAt: Date.now(),
    handled: false
  };
  var list = await getList(env, "inquiries");
  list.push(item);
  await saveList(env, "inquiries", list);
  return json({ ok:true });
}

/* DELETE /api/inquiries - admin only. Body: {id}. Removes an inquiry once
   the admin has replied to the customer. */
export async function onRequestDelete({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var id = body && body.id;
  if(!id) return json({ ok:false, error:"missing_id" }, 400);

  var list = await getList(env, "inquiries");
  var next = list.filter(function(r){ return r.id !== id; });
  if(next.length === list.length) return json({ ok:false, error:"not_found" }, 404);
  await saveList(env, "inquiries", next);
  return json({ ok:true });
}

/* PUT /api/inquiries - admin only. Body: {id, message}. Sends the reply to
   the customer's bell (matched by account or phone number) and removes the
   inquiry from the admin list, same as "done". Returns {ok, hasAccount}:
   false means no app account uses that phone yet (the reply shows up if they
   register with the same number). */
export async function onRequestPut({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var message = String(body && body.message || "").replace(/\r/g, "").trim().slice(0, 1000);
  if(!body || !body.id || !message) return json({ ok:false, error:"bad_request" }, 400);
  var list = await getList(env, "inquiries");
  var inq = list.find(function(r){ return r.id === body.id; });
  if(!inq) return json({ ok:false, error:"not_found" }, 404);
  await addNote(env, {
    type: "inquiry",
    customerId: inq.customerId || null,
    phoneTail: phoneTail(inq.phone),
    quote: String(inq.message || "").slice(0, 400),
    message: message
  });
  await saveList(env, "inquiries", list.filter(function(r){ return r.id !== body.id; }));
  return json({ ok:true, hasAccount: await hasAccountFor(env, inq.phone, inq.customerId) });
}
