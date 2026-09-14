import { json, getAdminAccount, saveAdminAccount, sha256Hex, requireAdmin } from "../../_lib.js";

/* POST /api/admin/settings  -  admin only (X-Admin-User / X-Admin-Pass
   headers = the CURRENT credentials, to prove it's really the owner).
   Body: {username, password, recoveryEmail, recoveryPhone} = the NEW
   values (password is optional  -  omit/empty to keep the current one). */
export async function onRequestPost({ request, env }){
  var acc = await requireAdmin(request, env);
  if(!acc) return json({ ok:false, error:"unauthorized" }, 401);

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var newUsername = (body && body.username || "").trim();
  var newPassword = (body && body.password || "");
  var recoveryEmail = (body && body.recoveryEmail || "").trim();
  var recoveryPhone = (body && body.recoveryPhone || "").trim();
  if(!newUsername){ return json({ ok:false, error:"missing_username" }, 400); }
  if(newPassword && newPassword.length < 6){ return json({ ok:false, error:"weak_password" }, 400); }

  acc.username = newUsername;
  if(newPassword) acc.passwordHash = await sha256Hex(newPassword);
  acc.recoveryEmail = recoveryEmail;
  acc.recoveryPhone = recoveryPhone;
  await saveAdminAccount(env, acc);
  return json({ ok:true, username: acc.username, recoveryEmail: acc.recoveryEmail || "", recoveryPhone: acc.recoveryPhone || "" });
}
