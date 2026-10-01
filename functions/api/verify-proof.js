import { json } from "../_lib.js";
import { dataUrlToBytes, checkReceipt } from "../_payproof.js";

/* POST /api/verify-proof  {image: "data:image/...;base64,...", total}
   Checks the transfer screenshot BEFORE the customer can place the order
   (see _payproof.js). The result is saved for 1 day under "pv:<imgHash>";
   /api/orders only accepts a Vodafone Cash / InstaPay order whose
   screenshot passed here (or "manual" when the AI checker is down).
   Simple abuse limit: 25 checks per hour per IP.
   (ASCII-only comments on purpose, same as _lib.js.) */

export async function onRequestPost({ request, env }){
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
    date: res.date || ""
  });
}
