import { json, getCustomers, saveCustomers, sha256Hex, linkGuestOrdersToCustomer } from "../../_lib.js";

/* POST /api/customers/register - public. Body: {phone, name, email, governorate, address, password}.
   Creates a customer account on the server (same trust model as the admin
   account: hashed password, custom auth headers on every later request).
   Phone is the login identifier and must be unique. The customer picks
   their own password on the sign-up form (confirmed twice client-side) -
   the server only validates a minimum length and hashes it, it never
   generates or stores it in plain text. governorate/address are saved on
   the account so they can be auto-filled into future orders instead of
   being retyped every time. */
export async function onRequestPost({ request, env }){
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var phone = (body && body.phone || "").trim();
  var name = (body && body.name || "").trim();
  var email = (body && body.email || "").trim().toLowerCase();
  var governorate = (body && body.governorate || "").trim();
  var address = (body && body.address || "").trim();
  var password = (body && body.password || "");
  if(!phone || !name || !email || !governorate || !address || !password){ return json({ ok:false, error:"missing_fields" }, 400); }
  if(password.length < 6){ return json({ ok:false, error:"weak_password" }, 400); }

  var list = await getCustomers(env);
  var exists = list.some(function(c){ return c.identifier.toLowerCase() === phone.toLowerCase(); });
  if(exists){ return json({ ok:false, error:"exists" }, 409); }
  var emailTaken = list.some(function(c){ return (c.email||"").toLowerCase() === email; });
  if(emailTaken){ return json({ ok:false, error:"exists" }, 409); }

  var passwordHash = await sha256Hex(password);
  var acct = {
    id: "cus_" + Date.now().toString(36) + Math.floor(Math.random() * 999),
    name: name,
    identifier: phone,
    email: email,
    governorate: governorate,
    address: address,
    passwordHash: passwordHash
  };
  list.push(acct);
  await saveCustomers(env, list);

  /* لو العميل ده كان طلب قبل كده كضيف بنفس رقم الموبايل، نربط طلباته
     القديمة بحسابه الجديد على طول عشان تبان له في "طلباتي". */
  try{ await linkGuestOrdersToCustomer(env, acct); }catch(e){ /* الربط مش سبب لفشل التسجيل نفسه */ }

  return json({ ok:true, name: acct.name, phone: acct.identifier, email: acct.email, governorate: acct.governorate, address: acct.address });
}
