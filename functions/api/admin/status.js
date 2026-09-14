import { json, getAdminAccount } from "../../_lib.js";

/* GET /api/admin/status  -  public. Just says whether an admin account has
   ever been created, so the client knows whether to show the first-time
   setup screen or the login screen. */
export async function onRequestGet({ env }){
  var acc = await getAdminAccount(env);
  return json({ exists: !!(acc && acc.username && acc.passwordHash) });
}
