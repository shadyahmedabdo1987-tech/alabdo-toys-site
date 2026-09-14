import { json, getAdminAccount, saveAdminAccount, sha256Hex } from "../../_lib.js";

/* POST /api/admin/setup  -  public, but only works ONCE: creates the store
   owner's account. If an account already exists this refuses (so a second
   visitor can't overwrite the real owner's login by hitting this directly). */
export async function onRequestPost({ request, env }){
  var existing = await getAdminAccount(env);
  if(existing && existing.username && existing.passwordHash){
    return json({ ok:false, error:"already_exists" }, 409);
  }
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var username = (body && body.username || "").trim();
  var password = (body && body.password || "");
  var recoveryEmail = (body && body.recoveryEmail || "").trim();
  var recoveryPhone = (body && body.recoveryPhone || "").trim();
  if(!username || !password){ return json({ ok:false, error:"missing_fields" }, 400); }
  if(password.length < 6){ return json({ ok:false, error:"weak_password" }, 400); }

  var passwordHash = await sha256Hex(password);
  await saveAdminAccount(env, { username: username, passwordHash: passwordHash, recoveryEmail: recoveryEmail, recoveryPhone: recoveryPhone });
  return json({ ok:true });
}
