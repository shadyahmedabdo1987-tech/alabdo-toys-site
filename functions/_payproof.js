/* Automatic check of the Vodafone Cash / InstaPay transfer screenshot.
   A vision AI model (Cloudflare Workers AI, binding name "AI") reads the
   receipt; then WE check (in code, not the AI):
     - it is a successful transfer receipt,
     - it was sent to the store's number (STORE_NUMBERS / env.STORE_PAY_NUMBERS,
       or an InstaPay address in env.STORE_IPA),
     - the amount is at least the order total,
     - it is recent (not older than MAX_AGE_DAYS when a date is readable),
     - the same receipt (transaction reference or the exact same image)
       was not used for another order before.
   This catches mistakes and re-used / wrong receipts. It can NOT prove the
   money really arrived (an edited screenshot can still look right) - the
   admin should still glance at the wallet before shipping.
   KV keys: "pv:<imgHash>" verification result (1 day),
            "pref:<reference>" / "pimg:<imgHash>" -> orderId once used.
   (ASCII-only comments on purpose, same as _lib.js.) */

export var STORE_NUMBERS = ["01099952333"];
var MAX_AGE_DAYS = 3;
/* Several ways of sending the image, because the Workers AI vision models
   don't all take the same input shape. The first one that answers is
   remembered in KV ("ai:variant") and tried first next time. */
var L4 = "@cf/meta/llama-4-scout-17b-16e-instruct";
/* Tested on the live site (Oct 2026): only Llama 4 Scout with the image
   inside the message (image_url data URL) really reads the receipt. The
   other shapes either fail or answer WITHOUT looking at the image (made-up
   numbers), so they are not used - if this one fails the order is marked
   for manual review instead of trusting a guess. */
export var VARIANTS = [
  { id: "l4-msg-url", model: L4, build: function(p, img){ return { messages: [{ role: "user", content: [{ type: "text", text: p }, { type: "image_url", image_url: { url: "data:" + img.type + ";base64," + img.b64 } }] }], max_tokens: 500, temperature: 0 }; } }
];

export function storeNumbers(env){
  var extra = String((env && env.STORE_PAY_NUMBERS) || "").split(/[,\s]+/).filter(Boolean);
  return STORE_NUMBERS.concat(extra);
}
export function toLatinDigits(s){
  return String(s == null ? "" : s)
    .replace(/[٠-٩]/g, function(d){ return String(d.charCodeAt(0) - 0x0660); })
    .replace(/[۰-۹]/g, function(d){ return String(d.charCodeAt(0) - 0x06F0); });
}
export async function sha256Bytes(bytes){
  var d = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(d)).map(function(b){ return b.toString(16).padStart(2, "0"); }).join("");
}
export function dataUrlToBytes(dataUrl){
  var m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+\/=\s]+)$/i.exec(String(dataUrl || ""));
  if(!m) return null;
  var bin = atob(m[2].replace(/\s+/g, ""));
  var bytes = new Uint8Array(bin.length);
  for(var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { type: m[1].toLowerCase(), bytes: bytes, b64: m[2].replace(/\s+/g, "") };
}
export function normRef(r){
  return toLatinDigits(r).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* does the recipient shown on the receipt match one of the store numbers?
   handles full numbers (+20 / 0020 / 0 prefixes) and masked ones
   (010****2333) */
export function recipientMatches(raw, env){
  var r = toLatinDigits(raw).trim();
  if(!r) return false;
  var ipas = String((env && env.STORE_IPA) || "").toLowerCase().split(/[,\s]+/).filter(Boolean);
  if(r.indexOf("@") > 0) return ipas.indexOf(r.toLowerCase().replace(/\s+/g, "")) >= 0;
  var nums = storeNumbers(env).map(function(n){ return toLatinDigits(n).replace(/\D/g, "").slice(-10); });
  var masked = /[*xX•.…#]/.test(r.replace(/[\s-]/g, "").replace(/^\+/, ""));
  if(!masked){
    var d = r.replace(/\D/g, "");
    if(d.length < 10) return false;
    return nums.indexOf(d.slice(-10)) >= 0;
  }
  /* masked: compare the visible digits at the start and at the end */
  var compact = r.replace(/[\s-]/g, "").replace(/^\+?20/, "0").replace(/^0020/, "0");
  var head = (/^\d+/.exec(compact) || [""])[0];
  var tail = (/\d+$/.exec(compact) || [""])[0];
  if(tail.length < 3) return false;
  return nums.some(function(n){
    var full = "0" + n;
    var okHead = !head || full.indexOf(head) === 0 || n.indexOf(head) === 0;
    return okHead && full.slice(-tail.length) === tail;
  });
}

var PROMPT = [
  "You are checking a screenshot that a customer uploaded as proof of a mobile money transfer in Egypt",
  "(Vodafone Cash, InstaPay, or a bank/wallet app). Read the image carefully. The text may be Arabic.",
  "Convert any Arabic-Indic digits to normal digits 0-9.",
  "Answer with ONLY one JSON object, no other text, with exactly these keys:",
  '{"is_receipt": true/false (is this a money transfer confirmation/receipt or transfer SMS?),',
  ' "success": true/false/null (does it say the transfer succeeded?),',
  ' "provider": "vodafone_cash" | "instapay" | "bank" | "other",',
  ' "amount": number or null (the amount TRANSFERRED in EGP, not the fees, not the balance),',
  ' "recipient": string (the RECEIVER (To / إلى / المستلم) phone number. If the full number is written anywhere in the receiver section, give the FULL number, not a masked one. Keep * only if it is masked everywhere; "" if not shown),',
  ' "recipient_numbers": array of strings (EVERY phone number / account number / InstaPay address shown in the receiver (To) section, full or masked, exactly as written),',
  ' "sender": string (the SENDER (From / من) phone / address, "" if not shown),',
  ' "recipient_name": string ("" if not shown),',
  ' "reference": string (transaction ID / reference number; "" if not shown),',
  ' "date": "YYYY-MM-DD" or "" }'
].join("\n");

function extractJson(out){
  if(out == null) return null;
  if(typeof out === "object" && !Array.isArray(out)){
    if(out.response != null) return extractJson(out.response);
    if("is_receipt" in out || "amount" in out) return out;
    if(out.choices && out.choices[0] && out.choices[0].message) return extractJson(out.choices[0].message.content);
    if(out.choices && out.choices[0] && out.choices[0].text != null) return extractJson(out.choices[0].text);
    return null;
  }
  var s = String(out);
  var a = s.indexOf("{"), b = s.lastIndexOf("}");
  if(a < 0 || b <= a) return null;
  try{ return JSON.parse(s.slice(a, b + 1)); }catch(e){ return null; }
}

async function runVariant(env, v, img){
  var t0 = Date.now();
  try{
    if(v.needsAgree){ try{ await env.AI.run(v.model, { prompt: "agree" }); }catch(e){} }
    var out = await env.AI.run(v.model, v.build(PROMPT, img));
    var j = extractJson(out);
    var raw = typeof out === "string" ? out : JSON.stringify(out);
    return { id: v.id, ok: !!j, json: j, ms: Date.now() - t0, raw: String(raw || "").slice(0, 400), error: j ? null : "no_json" };
  }catch(e){
    return { id: v.id, ok: false, json: null, ms: Date.now() - t0, raw: "", error: String((e && e.message) || e).slice(0, 300) };
  }
}

/* ask the AI; returns {json, variant, errors} - json null = AI not available */
export async function readReceipt(env, img){
  if(!env || !env.AI || typeof env.AI.run !== "function") return { json: null, errors: ["no_ai_binding"] };
  var first = null;
  try{ first = await env.STORE_KV.get("ai:variant"); }catch(e){}
  var order = VARIANTS.slice().sort(function(a, b){ return (a.id === first ? -1 : 0) - (b.id === first ? -1 : 0); });
  var errors = [];
  for(var i = 0; i < order.length; i++){
    var r = await runVariant(env, order[i], img);
    if(r.ok){
      if(order[i].id !== first){ try{ await env.STORE_KV.put("ai:variant", order[i].id); }catch(e){} }
      r.json._model = order[i].model;
      return { json: r.json, variant: order[i].id, errors: errors };
    }
    errors.push(order[i].id + ": " + r.error);
  }
  return { json: null, errors: errors };
}

/* admin test: run EVERY variant on one image and report each result */
export async function diagnose(env, img){
  var out = { hasAI: !!(env && env.AI && typeof env.AI.run === "function"), results: [] };
  if(!out.hasAI) return out;
  for(var i = 0; i < VARIANTS.length; i++) out.results.push(await runVariant(env, VARIANTS[i], img));
  return out;
}

function num(v){
  if(v == null) return null;
  var s = toLatinDigits(v).replace(/[,٬\s]/g, "").replace(/٫/g, ".");
  var m = /-?\d+(\.\d+)?/.exec(s);
  return m ? +m[0] : null;
}

/* full check -> { status:"ok"|"fail"|"manual", reason, amount, recipient, reference, provider, date } */
export async function checkReceipt(env, img, expectedTotal){
  var hash = await sha256Bytes(img.bytes);
  var usedImg = await env.STORE_KV.get("pimg:" + hash);
  if(usedImg) return { status:"fail", reason:"reused", hash: hash };

  var rr = await readReceipt(env, img);
  if(!rr.json) return { status:"manual", reason:"ai_unavailable", hash: hash, aiErrors: rr.errors };
  var r = rr.json;

  var res = {
    hash: hash,
    provider: String(r.provider || ""),
    amount: num(r.amount),
    recipient: toLatinDigits(r.recipient || "").slice(0, 60),
    recipientName: String(r.recipient_name || "").slice(0, 60),
    reference: String(toLatinDigits(r.reference || "")).slice(0, 60),
    date: String(r.date || "").slice(0, 10),
    model: r._model,
    variant: rr.variant
  };
  function fail(reason){ res.status = "fail"; res.reason = reason; return res; }

  if(r.is_receipt === false) return fail("not_receipt");
  if(r.success === false) return fail("not_success");
  /* the receiver may be written twice (masked + full): a FULL number wins */
  var cands = [res.recipient].concat(Array.isArray(r.recipient_numbers) ? r.recipient_numbers.map(function(x){ return toLatinDigits(x).slice(0, 60); }) : []).filter(Boolean);
  var full = cands.filter(function(x){ return !/[*xX\u2022\u2026#]/.test(x) && (x.replace(/\D/g, "").length >= 10 || x.indexOf("@") > 0); });
  if(!cands.length) return fail("no_recipient");
  if(full.length){
    res.recipient = full[0];
    if(!full.some(function(x){ return recipientMatches(x, env); })) return fail("wrong_recipient");
    res.recipient = full.filter(function(x){ return recipientMatches(x, env); })[0];
  } else if(!cands.some(function(x){ return recipientMatches(x, env); })) return fail("wrong_recipient");
  if(res.amount == null) return fail("no_amount");
  if(res.amount + 1 < (+expectedTotal || 0)) return fail("low_amount");
  if(/^\d{4}-\d{2}-\d{2}$/.test(res.date)){
    var t = Date.parse(res.date + "T23:59:59+02:00");
    if(t && Date.now() - t > MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return fail("old");
  }
  var ref = normRef(res.reference);
  if(ref.length >= 6){
    var usedRef = await env.STORE_KV.get("pref:" + ref);
    if(usedRef) return fail("reused");
  }
  res.status = "ok";
  return res;
}
