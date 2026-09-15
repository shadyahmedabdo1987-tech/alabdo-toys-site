import { json, getCustomers, saveCustomers, sha256Hex } from "../../_lib.js";

/* POST /api/customers/register - public. Body: {phone, name, email}.
   Creates a customer account on the server (same trust model as the admin
   account: hashed password, custom auth headers on every later request).
   Phone is the login identifier and must be unique. A random 6-digit
   password is generated and returned once so the client can show it on
   screen, matching the site's existing customer-signup UX. */
function generateSixDigits(){
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function onRequestPost({ request, env }){
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var phone = (body && body.phone || "").trim();
  var name = (body && body.name || "").trim();
  var email = (body && body.email || "").trim().toLowerCase();
  if(!phone || !name || !email){ return json({ ok:false, error:"missing_fields" }, 400); }

  var list = await getCustomers(env);
  var exists = list.some(function(c){ return c.identifier.toLowerCase() === phone.toLowerCase(); });
  if(exists){ return json({ ok:false, error:"exists" }, 409); }

  var password = generateSixDigits();
  var passwordHash = await sha256Hex(password);
  var acct = {
    id: "cus_" + Date.now().toString(36) + Math.floor(Math.random() * 999),
    name: name,
    identifier: phone,
    email: email,
    passwordHash: passwordHash
  };
  list.push(acct);
  await saveCustomers(env, list);
  return json({ ok:true, name: acct.name, phone: acct.identifier, email: acct.email, password: password });
}
