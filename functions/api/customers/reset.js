import { json, getCustomers, saveCustomers, sha256Hex } from "../../_lib.js";

/* POST /api/customers/reset - public. Body: {phone, email}. Both the
   registered phone AND the registered email must match (same trade-off
   already used for the admin's recovery flow) - generates a fresh
   password, stores it, and returns it once on screen (no email sent). */
export async function onRequestPost({ request, env }){
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, reason:"bad_json" }, 400); }
  var phone = (body && body.phone || "").trim();
  var email = (body && body.email || "").trim().toLowerCase();
  if(!phone || !email) return json({ ok:false, reason:"missing_fields" });

  var list = await getCustomers(env);
  var idx = list.findIndex(function(c){ return c.identifier.toLowerCase() === phone.toLowerCase(); });
  if(idx === -1) return json({ ok:false, reason:"not_found" });
  var acct = list[idx];
  if(!acct.email || acct.email.toLowerCase() !== email) return json({ ok:false, reason:"mismatch" });

  var newPass = String(Math.floor(100000 + Math.random() * 900000));
  acct.passwordHash = await sha256Hex(newPass);
  list[idx] = acct;
  await saveCustomers(env, list);
  return json({ ok:true, password: newPass });
}
