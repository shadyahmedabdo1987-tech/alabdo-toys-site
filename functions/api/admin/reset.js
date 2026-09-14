import { json, getAdminAccount, saveAdminAccount, generatePassword, sha256Hex } from "../../_lib.js";

/* POST /api/admin/reset - body {email, phone}. If they match the recovery
   email AND recovery phone saved via the admin settings screen, generates a
   fresh password, stores it, and returns it once on screen (no email is
   actually sent - same trade-off as before, just checked centrally now). */
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

  var newPass = generatePassword(10);
  acc.passwordHash = await sha256Hex(newPass);
  await saveAdminAccount(env, acc);
  return json({ ok:true, password: newPass });
}
