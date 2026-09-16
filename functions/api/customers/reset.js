import { json, getCustomers, saveCustomers } from "../../_lib.js";

/* POST /api/customers/reset - public. Body: {phone, email}. Step 1 of the
   password-reset flow: both the registered phone AND the registered email
   must match (same trade-off already used for the admin's recovery flow).
   On a match, generates a one-time 6-digit verification code, stores it on
   the account (with a 15-minute expiry) and returns it once so the client
   can show it on screen. The customer picks their actual new password in
   step 2 at /api/customers/reset-confirm - this endpoint never sets a
   password itself. */
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

  var code = String(Math.floor(100000 + Math.random() * 900000));
  acct.resetCode = code;
  acct.resetCodeExpires = Date.now() + 15 * 60 * 1000;
  list[idx] = acct;
  await saveCustomers(env, list);
  return json({ ok:true, code: code });
}
