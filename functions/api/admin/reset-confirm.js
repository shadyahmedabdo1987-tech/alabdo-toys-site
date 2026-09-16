import { json, getAdminAccount, saveAdminAccount, sha256Hex } from "../../_lib.js";

/* POST /api/admin/reset-confirm - body {code, password}. Step 2 of the
   admin password-reset flow: checks the one-time code issued by
   /api/admin/reset (and that it hasn't expired), then sets the admin's own
   new password (chosen on the client, confirmed twice there) and clears
   the code so it can't be reused. */
export async function onRequestPost({ request, env }){
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, reason:"bad_json" }, 400); }
  var code = (body && body.code || "").trim();
  var password = (body && body.password || "");
  if(!code || !password) return json({ ok:false, reason:"missing_fields" });
  if(password.length < 6) return json({ ok:false, reason:"weak_password" });

  var acc = await getAdminAccount(env);
  if(!acc) return json({ ok:false, reason:"not_configured" });
  if(!acc.resetCode || acc.resetCode !== code) return json({ ok:false, reason:"bad_code" });
  if(!acc.resetCodeExpires || Date.now() > acc.resetCodeExpires) return json({ ok:false, reason:"expired" });

  acc.passwordHash = await sha256Hex(password);
  delete acc.resetCode;
  delete acc.resetCodeExpires;
  await saveAdminAccount(env, acc);
  return json({ ok:true, username: acc.username });
}
