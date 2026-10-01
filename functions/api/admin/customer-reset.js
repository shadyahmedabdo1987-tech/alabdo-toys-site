import { json, getCustomers, saveCustomers, sha256Hex, requireAdmin } from "../../_lib.js";

/* POST /api/admin/customer-reset  (admin only)  Body: {id}
   For a customer who forgot their password: makes a one-time link
   (valid 24 hours) that the admin sends to the customer (WhatsApp). The
   customer opens it and types a NEW password themselves - the admin never
   sees or chooses it. Only the hash of the link token is stored. The old
   password keeps working until the customer sets the new one.
   Completed at /api/customers/reset-confirm with {token, password}.
   (ASCII-only comments on purpose, same as _lib.js.) */

var LINK_HOURS = 24;

function randomHex(n){
  var a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a).map(function(b){ return b.toString(16).padStart(2, "0"); }).join("");
}

export async function onRequestPost({ request, env }){
  var admin = await requireAdmin(request, env);
  if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var id = body && body.id;
  if(!id) return json({ ok:false, error:"missing_id" }, 400);

  var list = await getCustomers(env);
  var idx = list.findIndex(function(c){ return c.id === id; });
  if(idx === -1) return json({ ok:false, error:"not_found" }, 404);

  var token = randomHex(20);
  var acct = list[idx];
  acct.resetLinkHash = await sha256Hex(token);
  acct.resetLinkExpires = Date.now() + LINK_HOURS * 60 * 60 * 1000;
  list[idx] = acct;
  await saveCustomers(env, list);

  var origin = new URL(request.url).origin;
  return json({
    ok: true,
    link: origin + "/?reset=" + token,
    name: acct.name || "",
    phone: acct.identifier || "",
    expiresAt: acct.resetLinkExpires
  });
}
