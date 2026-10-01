import { json, getCustomers, saveCustomers, sha256Hex } from "../../_lib.js";

/* POST /api/customers/reset-confirm - public. Body: {phone, code, password}.
   Step 2 of the password-reset flow: checks the one-time code issued by
   /api/customers/reset (and that it hasn't expired), then sets the
   customer's own new password (chosen on the client, same as at signup)
   and clears the code so it can't be reused. */
/* Admin-made reset link (see /api/admin/customer-reset): the link carries a
   random token; only its hash is stored on the account (resetLinkHash),
   valid 24h and usable once. */
async function findByToken(list, token){
  if(!/^[a-f0-9]{40}$/.test(token)) return -1;
  var h = await sha256Hex(token);
  return list.findIndex(function(c){ return c.resetLinkHash && c.resetLinkHash === h; });
}

/* GET /api/customers/reset-confirm?token=... - is the link still valid?
   Returns the customer's first name + a masked phone so the page can greet
   them before they type the new password. */
export async function onRequestGet({ request, env }){
  var token = String(new URL(request.url).searchParams.get("token") || "");
  var list = await getCustomers(env);
  var idx = await findByToken(list, token);
  if(idx === -1) return json({ ok:false, reason:"bad_link" });
  var acct = list[idx];
  if(!acct.resetLinkExpires || Date.now() > acct.resetLinkExpires) return json({ ok:false, reason:"expired" });
  var ph = String(acct.identifier || "");
  return json({ ok:true, name: String(acct.name || "").split(" ")[0], phone: ph.length > 4 ? ph.slice(0, 3) + "*****" + ph.slice(-3) : ph });
}

export async function onRequestPost({ request, env }){
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, reason:"bad_json" }, 400); }

  /* new password from the admin-made link */
  if(body && body.token){
    var pw = String(body.password || "");
    if(pw.length < 6) return json({ ok:false, reason:"weak_password" });
    var all = await getCustomers(env);
    var i = await findByToken(all, String(body.token));
    if(i === -1) return json({ ok:false, reason:"bad_link" });
    var a = all[i];
    if(!a.resetLinkExpires || Date.now() > a.resetLinkExpires) return json({ ok:false, reason:"expired" });
    a.passwordHash = await sha256Hex(pw);
    delete a.resetLinkHash;
    delete a.resetLinkExpires;
    delete a.resetCode;
    delete a.resetCodeExpires;
    all[i] = a;
    await saveCustomers(env, all);
    return json({ ok:true, phone: a.identifier, name: a.name || "", email: a.email || "", governorate: a.governorate || "", address: a.address || "" });
  }

  var phone = (body && body.phone || "").trim();
  var code = (body && body.code || "").trim();
  var password = (body && body.password || "");
  if(!phone || !code || !password) return json({ ok:false, reason:"missing_fields" });
  if(password.length < 6) return json({ ok:false, reason:"weak_password" });

  var list = await getCustomers(env);
  var idx = list.findIndex(function(c){ return c.identifier.toLowerCase() === phone.toLowerCase(); });
  if(idx === -1) return json({ ok:false, reason:"not_found" });
  var acct = list[idx];
  if(!acct.resetCode || acct.resetCode !== code) return json({ ok:false, reason:"bad_code" });
  if(!acct.resetCodeExpires || Date.now() > acct.resetCodeExpires) return json({ ok:false, reason:"expired" });

  acct.passwordHash = await sha256Hex(password);
  delete acct.resetCode;
  delete acct.resetCodeExpires;
  list[idx] = acct;
  await saveCustomers(env, list);
  return json({ ok:true, phone: acct.identifier });
}
