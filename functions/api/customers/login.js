import { json, getCustomers, sha256Hex, linkGuestOrdersToCustomer } from "../../_lib.js";

/* POST /api/customers/login - public. Body: {identifier, password}.
   identifier can be either the registered phone number or the registered
   email - both are accepted so the customer doesn't have to remember which
   one they used at signup. */
export async function onRequestPost({ request, env }){
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false }, 400); }
  var idRaw = (body && body.identifier || "").trim().toLowerCase();
  var password = (body && body.password || "");
  if(!idRaw || !password) return json({ ok:false });

  var list = await getCustomers(env);
  var acct = list.find(function(c){
    return c.identifier.toLowerCase() === idRaw || (c.email||"").toLowerCase() === idRaw;
  });
  if(!acct) return json({ ok:false });
  var hash = await sha256Hex(password);
  if(hash !== acct.passwordHash) return json({ ok:false });

  /* لو حصل طلب كضيف بنفس رقم موبايل الحساب ده من بعد آخر مرة سجّل
     فيها دخول، بنربطه بحسابه هنا كمان - مش بس وقت التسجيل الأول. */
  try{ await linkGuestOrdersToCustomer(env, acct); }catch(e){ /* الربط مش سبب لفشل الدخول نفسه */ }

  return json({ ok:true, name: acct.name, phone: acct.identifier, email: acct.email, governorate: acct.governorate || "", address: acct.address || "" });
}
