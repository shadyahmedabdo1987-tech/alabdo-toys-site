import { json, getCustomers, sha256Hex } from "../../_lib.js";

/* POST /api/customers/login - public. Body: {identifier, password}. */
export async function onRequestPost({ request, env }){
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false }, 400); }
  var phone = (body && body.identifier || "").trim();
  var password = (body && body.password || "");
  if(!phone || !password) return json({ ok:false });

  var list = await getCustomers(env);
  var acct = list.find(function(c){ return c.identifier.toLowerCase() === phone.toLowerCase(); });
  if(!acct) return json({ ok:false });
  var hash = await sha256Hex(password);
  if(hash !== acct.passwordHash) return json({ ok:false });
  return json({ ok:true, name: acct.name, phone: acct.identifier, email: acct.email });
}
