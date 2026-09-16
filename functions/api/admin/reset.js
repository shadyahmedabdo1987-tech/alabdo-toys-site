import { json, getAdminAccount, saveAdminAccount } from "../../_lib.js";

/* POST /api/admin/reset - body {email, phone}. Step 1 of the admin
   password-reset flow (same two-step design as the customer one): if the
   recovery email AND recovery phone match what was saved via the admin
   settings screen, generates a one-time 6-digit verification code, stores
   it on the account (with a 15-minute expiry) and returns it once so it
   can be shown on screen. The admin picks their own new password in step 2
   at /api/admin/reset-confirm - this endpoint never sets a password. */
export async function onRequestPost({ request, env }){
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, reason:"bad_json" }, 400); }
  var email = (body && body.email || "").trim().toLowerCase();
  var phone = (body && body.phone || "").trim();

  var acc = await getAdminAccount(env);
  if(!acc) return json({ ok:false, reason:"not_configured" });
  if(!acc.recoveryEmail || !acc.recoveryPhone) return json({ ok:false, reason:"not_configured" });
  if(acc.recoveryEmail.toLowerCase() !== email || acc.recoveryPhone !== phone){
    return json({ ok:false, reason:"mismatch" });
  }

  var code = String(Math.floor(100000 + Math.random() * 900000));
  acc.resetCode = code;
  acc.resetCodeExpires = Date.now() + 15 * 60 * 1000;
  await saveAdminAccount(env, acc);
  return json({ ok:true, code: code });
}
