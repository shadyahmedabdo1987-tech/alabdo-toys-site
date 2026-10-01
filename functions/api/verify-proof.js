import { json, requireAdmin } from "../_lib.js";
import { dataUrlToBytes, checkReceipt, diagnose, recipientMatches } from "../_payproof.js";

/* POST /api/verify-proof  {image: "data:image/...;base64,...", total}
   Checks the transfer screenshot BEFORE the customer can place the order
   (see _payproof.js). The result is saved for 1 day under "pv:<imgHash>";
   /api/orders only accepts a Vodafone Cash / InstaPay order whose
   screenshot passed here (or "manual" when the AI checker is down).
   Simple abuse limit: 25 checks per hour per IP.
   (ASCII-only comments on purpose, same as _lib.js.) */

export async function onRequestPost(context){
  var request = context.request, env = context.env;
  /* admin test of the AI reader: {action:"diag", image} -> every model/format */
  if(request.headers.get("X-Admin-User")){
    var admin = await requireAdmin(request, env);
    if(!admin) return json({ ok:false, error:"unauthorized" }, 401);
    var b0; try{ b0 = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
    var im0 = dataUrlToBytes(b0 && b0.image);
    if(!im0) return json({ ok:false, error:"bad_image" }, 400);
    var d = await diagnose(env, im0);
    d.results.forEach(function(r){ if(r.json && r.json.recipient != null) r.recipientOk = recipientMatches(r.json.recipient, env); });
    return json({ ok:true, diag: d });
  }
  return verify(request, env);
}

async function verify(request, env){
  var ip = request.headers.get("CF-Connecting-IP") || "x";
  var rk = "rl:vp:" + ip + ":" + Math.floor(Date.now() / 3600000);
  var n = +(await env.STORE_KV.get(rk)) || 0;
  if(n >= 25) return json({ ok:false, status:"fail", reason:"too_many" }, 429);
  await env.STORE_KV.put(rk, String(n + 1), { expirationTtl: 3700 });

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var img = dataUrlToBytes(body && body.image);
  if(!img || img.bytes.length < 500) return json({ ok:false, status:"fail", reason:"bad_image" }, 400);
  if(img.bytes.length > 8 * 1024 * 1024) return json({ ok:false, status:"fail", reason:"too_big" }, 413);
  var total = Math.max(0, +body.total || 0);

  var res = await checkReceipt(env, img, total);
  res.total = total;
  res.at = Date.now();
  await env.STORE_KV.put("pv:" + res.hash, JSON.stringify(res), { expirationTtl: 86400 });
  return json({
    ok: res.status !== "fail",
    status: res.status,
    reason: res.reason || null,
    amount: res.amount != null ? res.amount : null,
    recipient: res.recipient || "",
    reference: res.reference || "",
    provider: res.provider || "",
    date: res.date || "",
    debug: res.aiErrors ? res.aiErrors.slice(0, 5) : undefined
  });
}
