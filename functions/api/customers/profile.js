import { json, getCustomers, saveCustomers, requireCustomer, sha256Hex } from "../../_lib.js";

/* POST /api/customers/profile - customer only (X-Customer-Id / X-Customer-Pass
   headers, same as every other customer endpoint). Lets a logged-in customer
   edit their own personal data from "My account": name, email, governorate,
   address, and optionally a new password (newPassword, 6+ characters).
   The phone number is the login identifier (and links the customer's
   orders), so it can't be changed here.
   Body: {name, email, governorate, address, newPassword?}
   Returns {ok, name, phone, email, governorate, address}.
   (ASCII-only comments on purpose, same as _lib.js.) */
export async function onRequestPost({ request, env }){
  var customer = await requireCustomer(request, env);
  if(!customer) return json({ ok:false, error:"unauthorized" }, 401);

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var name = String(body && body.name || "").trim();
  var email = String(body && body.email || "").trim().toLowerCase();
  var governorate = String(body && body.governorate || "").trim();
  var address = String(body && body.address || "").trim();
  var newPassword = String(body && body.newPassword || "");
  if(!name || !email || !governorate || !address) return json({ ok:false, error:"missing_fields" }, 400);
  if(newPassword && newPassword.length < 6) return json({ ok:false, error:"weak_password" }, 400);

  var list = await getCustomers(env);
  var idx = list.findIndex(function(c){ return c.identifier === customer.identifier; });
  if(idx === -1) return json({ ok:false, error:"unauthorized" }, 401);
  var emailTaken = list.some(function(c, i){ return i !== idx && (c.email || "").toLowerCase() === email; });
  if(emailTaken) return json({ ok:false, error:"email_taken" }, 409);

  var acct = list[idx];
  acct.name = name;
  acct.email = email;
  acct.governorate = governorate;
  acct.address = address;
  if(newPassword) acct.passwordHash = await sha256Hex(newPassword);
  acct.updatedAt = Date.now();
  await saveCustomers(env, list);

  return json({ ok:true, name: acct.name, phone: acct.identifier, email: acct.email, governorate: acct.governorate, address: acct.address });
}
