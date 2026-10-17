import { json, getCustomers, sha256Hex } from "../../_lib.js";

/* GET /api/customers/session - the customer app/site asks "is my login still
   valid?" when it opens and every little while after that.
   - {ok:true}                      -> still logged in
   - 401 {error:"gone"}             -> the account was deleted (by the store or
                                       by the customer) -> log out right away
   - 401 {error:"changed"}          -> phone or password was changed from the
                                       admin dashboard -> log in again
   (ASCII-only comments on purpose, same as _lib.js.) */
export async function onRequestGet({ request, env }){
  var id = String(request.headers.get("X-Customer-Id") || "").trim();
  var pass = String(request.headers.get("X-Customer-Pass") || "");
  if(!id || !pass) return json({ ok:false, error:"no_session" }, 400);
  var list = await getCustomers(env);
  var acc = list.find(function(c){ return String(c.identifier || "").toLowerCase() === id.toLowerCase(); });
  if(!acc) return json({ ok:false, error:"gone" }, 401);
  if(await sha256Hex(pass) !== acc.passwordHash) return json({ ok:false, error:"changed" }, 401);
  return json({ ok:true });
}
