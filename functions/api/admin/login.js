import { json, getAdminAccount, sha256Hex } from "../../_lib.js";

/* POST /api/admin/login  -  body {username, password}. The client-side
   lockout (5 tries / 5 min) still happens in the browser as before; this
   endpoint just says whether the credentials are correct. */
export async function onRequestPost({ request, env }){
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false }, 400); }
  var username = (body && body.username || "").trim();
  var password = (body && body.password || "");
  if(!username || !password) return json({ ok:false });

  var acc = await getAdminAccount(env);
  if(!acc) return json({ ok:false });
  if(acc.username !== username) return json({ ok:false });
  var hash = await sha256Hex(password);
  if(hash !== acc.passwordHash) return json({ ok:false });
  return json({ ok:true, recoveryEmail: acc.recoveryEmail || "", recoveryPhone: acc.recoveryPhone || "" });
}
