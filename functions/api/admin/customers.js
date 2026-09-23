import { json, getCustomers, saveCustomers, sha256Hex, requireAdmin } from "../../_lib.js";

/* Strips the password hash before sending a customer account back to the
   admin dashboard - the admin can see and edit everything else, but there
   is no reason the hash itself needs to leave the server. */
function publicCustomer(c){
  return {
    id: c.id, name: c.name, identifier: c.identifier, email: c.email || "",
    governorate: c.governorate || "", address: c.address || ""
  };
}

/* GET /api/admin/customers - admin only. Returns every registered customer
   account, for the "بيانات العملاء" page in the admin dashboard. */
export async function onRequestGet({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var list = await getCustomers(env);
  return json({ ok:true, customers: list.map(publicCustomer) });
}

/* POST /api/admin/customers - admin only. Body: {id, name, identifier,
   email, governorate, address, password}. Updates an existing customer
   account (matched by id) with full admin control over every field -
   password is optional, leave it empty to keep the customer's current one. */
export async function onRequestPost({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var id = body && body.id;
  if(!id) return json({ ok:false, error:"missing_id" }, 400);

  var name = (body && body.name || "").trim();
  var identifier = (body && body.identifier || "").trim();
  var email = (body && body.email || "").trim().toLowerCase();
  var governorate = (body && body.governorate || "").trim();
  var address = (body && body.address || "").trim();
  var password = (body && body.password || "");
  if(!name || !identifier || !email){ return json({ ok:false, error:"missing_fields" }, 400); }
  if(password && password.length < 6){ return json({ ok:false, error:"weak_password" }, 400); }

  var list = await getCustomers(env);
  var idx = list.findIndex(function(c){ return c.id === id; });
  if(idx === -1) return json({ ok:false, error:"not_found" }, 404);

  var identifierTaken = list.some(function(c,i){ return i!==idx && c.identifier.toLowerCase()===identifier.toLowerCase(); });
  if(identifierTaken) return json({ ok:false, error:"identifier_taken" }, 409);
  var emailTaken = list.some(function(c,i){ return i!==idx && (c.email||"").toLowerCase()===email; });
  if(emailTaken) return json({ ok:false, error:"email_taken" }, 409);

  var acct = list[idx];
  acct.name = name;
  acct.identifier = identifier;
  acct.email = email;
  acct.governorate = governorate;
  acct.address = address;
  if(password) acct.passwordHash = await sha256Hex(password);
  await saveCustomers(env, list);
  return json({ ok:true, customer: publicCustomer(acct) });
}

/* DELETE /api/admin/customers - admin only. Body: {id}. Permanently removes
   a customer account. */
export async function onRequestDelete({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var id = body && body.id;
  if(!id) return json({ ok:false, error:"missing_id" }, 400);

  var list = await getCustomers(env);
  var next = list.filter(function(c){ return c.id !== id; });
  if(next.length === list.length) return json({ ok:false, error:"not_found" }, 404);
  await saveCustomers(env, next);
  return json({ ok:true });
}
