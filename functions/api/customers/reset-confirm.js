import { json, getCustomers, saveCustomers, sha256Hex } from "../../_lib.js";

/* POST /api/customers/reset-confirm - public. Body: {phone, code, password}.
   Step 2 of the password-reset flow: checks the one-time code issued by
   /api/customers/reset (and that it hasn't expired), then sets the
   customer's own new password (chosen on the client, same as at signup)
   and clears the code so it can't be reused. */
export async function onRequestPost({ request, env }){
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, reason:"bad_json" }, 400); }
  var phone = (body && body.phone || "").trim();
  var code = (body && body.code || "").trim();
  var password = (body && body.password || "");
  if(!phone || !code || !password) return json({ ok:false, reason:"missing_fields" });
  if(password.length < 6) return json({ ok:false, reason:"weak_password" });

  var list = await getCustomers(env);
  var idx = list.findIndex(function(c){ return c.identifier.toLowerCase() === phone.toLowerCase(); });
  if(idx === -1) return json({ ok:false, reason:"not_found" });
  var acct = list[idx];
  if(!acct.resetCode || acct.resetCode !== code) return json({ ok:false, reason:"bad_code" });
  if(!acct.resetCodeExpires || Date.now() > acct.resetCodeExpires) return json({ ok:false, reason:"expired" });

  acct.passwordHash = await sha256Hex(password);
  delete acct.resetCode;
  delete acct.resetCodeExpires;
  list[idx] = acct;
  await saveCustomers(env, list);
  return json({ ok:true, phone: acct.identifier });
}
