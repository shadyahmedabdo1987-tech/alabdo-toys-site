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
   money really arrived (an edited screenshot can still look right) - so
   every transfer order is created with payPending=true and can't move to
   preparing/shipped until the admin confirms the money reached the wallet
   (api/order-status {pay:"confirm"}).
   Extra anti-tamper checks (Nov 2026, after an edited InstaPay receipt):
     - photo-editor signatures in the file (Canva, Snapseed, PicsArt,
       Photoshop, Lightroom, ...) -> "edited"
     - the image must be a full phone screenshot (portrait phone ratio) ->
       otherwise "cropped"
     - the AI is asked for visual edit signs (different fonts/sizes in the
       numbers, blurred or pasted patches, misaligned text) -> "edited"
     - the transfer time must be recent (MAX_AGE_MIN) and not in the future,
       and the phone status-bar clock must be at/after the transfer time ->
       otherwise "stale" / "edited"
   KV keys: "pv:<imgHash>" verification result (1 day),
            "pref:<reference>" / "pimg:<imgHash>" -> orderId once used.
   (ASCII-only comments on purpose, same as _lib.js.) */

export var STORE_NUMBERS = ["01099952333"];
/* the store's InstaPay address (IPA) - customers can pay to it instead of the number */
export var STORE_IPAS = ["shady1088@instapay"];
var MAX_AGE_DAYS = 3;
/* a transfer older than this (minutes) is refused: pay, then upload right away */
var MAX_AGE_MIN = 6 * 60;
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
  var ipas = STORE_IPAS.concat(String((env && env.STORE_IPA) || "").split(/[,\s]+/)).map(function(x){ return String(x).toLowerCase().trim(); }).filter(Boolean);
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
  ' "recipient_numbers": array of strings (EVERY phone number / account number / InstaPay address (like name@instapay) shown in the receiver (To) section ONLY, full or masked, exactly as written - never include anything from the sender (From) section),',
  ' "sender": string (the SENDER (From / من) phone or InstaPay address, "" if not shown),',
  ' "recipient_name": string ("" if not shown),',
  ' "reference": string (the transaction reference number exactly as written on the receipt - labels like "Reference number", "Reference No", "Ref", "Transaction ID", "Txn ID", "رقم المرجع", "الرقم المرجعي", "رقم مرجعي", "رقم العملية", "رقم المعاملة". Copy it character by character. "" if no reference number is shown - never invent one, never use a phone number, amount, date or balance as the reference),',
  ' "date": "YYYY-MM-DD" or "",',
  ' "time": "HH:MM" (24-hour time of the transfer written on the receipt, "" if not shown),',
  ' "status_bar_time": "HH:MM" (the phone clock in the top status bar of the screenshot, exactly as shown, "" if there is no status bar),',
  ' "edited": true/false (true ONLY if you see clear visual signs that this screenshot was edited: the amount, phone number, name, date or reference uses a different font, size, weight, color or alignment than the text around it, blurred/smudged or pasted patches, background color not matching behind some text, overlapping or cut characters, or a cropped image that is not a full phone screen),',
  ' "edit_reason": string (short reason when edited is true, else "") }'
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

/* decides if the receipt was sent to the store (see comment inside) */
export function pickRecipient(env, r)
{
  /* receiver candidates (the AI may write the receiver twice: masked + full).
     Anything equal to the SENDER is dropped (e.g. the owner paying from his
     own shady1088@instapay to someone else). A full phone number or an
     InstaPay address in the receiver section decides; masked numbers are
     only used when nothing full is shown. */
  function key(x){ var t = toLatinDigits(x).toLowerCase().replace(/\s+/g, ""); return t.indexOf("@") > 0 ? t : t.replace(/\D/g, "").slice(-10); }
  var sender = toLatinDigits(r.sender || "");
  var senderKey = sender ? key(sender) : "";
  var cands = [toLatinDigits(r.recipient || "").slice(0, 60)].concat(Array.isArray(r.recipient_numbers) ? r.recipient_numbers.map(function(x){ return toLatinDigits(x).slice(0, 60); }) : [])
    .filter(Boolean).filter(function(x){ return !senderKey || key(x) !== senderKey; });
  if(!cands.length) return { ok:false, reason:"no_recipient", recipient:"" };
  var isMasked = function(x){ return /[*xX\u2022\u2026#]/.test(x); };
  var fullPhones = cands.filter(function(x){ return x.indexOf("@") < 0 && !isMasked(x) && x.replace(/\D/g, "").length >= 10; });
  var ipaCands = cands.filter(function(x){ return x.indexOf("@") > 0; });
  var match = function(x){ return recipientMatches(x, env); };
  if(fullPhones.length || ipaCands.length){
    var hit = fullPhones.concat(ipaCands).filter(match)[0];
    var otherPhone = fullPhones.filter(function(x){ return !match(x); })[0];
    var shown = hit || otherPhone || ipaCands[0] || cands[0];
    if(!hit) return { ok:false, reason:"wrong_recipient", recipient: shown };
    return { ok:true, reason:null, recipient: shown };
  } else {
    var shown2 = cands.filter(match)[0] || cands[0];
    if(!cands.some(match)) return { ok:false, reason:"wrong_recipient", recipient: shown2 };
    return { ok:true, reason:null, recipient: shown2 };
  }
}
/* ---------- anti-tamper helpers ---------- */
var EDITOR_RE = /(canva|snapseed|picsart|adobe photoshop|photoshop express|photoshop cc|lightroom|gimp|pixlr|fotor|photopea|meitu|photoroom|polarr|vsco|picmonkey|befunky|inshot|photo editor|photodirector|picsay|airbrush|remini|photo lab|retouch|xodo)/i;
function latin1(bytes, from, to){
  var out = "", a = Math.max(0, from), b = Math.min(bytes.length, to);
  for(var i = a; i < b; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(b, i + 8192)));
  return out;
}
/* editor names found in the file metadata (EXIF Software, XMP CreatorTool, PNG text) */
export function editorSignatures(bytes){
  var found = [];
  var txt = latin1(bytes, 0, 262144) + latin1(bytes, bytes.length - 65536, bytes.length);
  var re = new RegExp(EDITOR_RE.source, "gi"), m;
  while((m = re.exec(txt))){ var k = m[1].toLowerCase(); if(found.indexOf(k) < 0) found.push(k); if(found.length > 5) break; }
  return found;
}
/* width/height of a JPEG / PNG / WebP */
export function imageSize(bytes){
  var b = bytes;
  if(b[0] === 0x89 && b[1] === 0x50) return { w: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, h: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 };
  if(b[0] === 0xFF && b[1] === 0xD8){
    var i = 2;
    while(i + 9 < b.length){
      if(b[i] !== 0xFF){ i++; continue; }
      var mk = b[i + 1];
      if(mk === 0xD8 || mk === 0x01 || (mk >= 0xD0 && mk <= 0xD7)){ i += 2; continue; }
      var len = b[i + 2] << 8 | b[i + 3];
      if(mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) return { w: b[i + 7] << 8 | b[i + 8], h: b[i + 5] << 8 | b[i + 6] };
      i += 2 + len;
    }
    return null;
  }
  if(b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45){
    var tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if(tag === "VP8X") return { w: 1 + (b[24] | b[25] << 8 | b[26] << 16), h: 1 + (b[27] | b[28] << 8 | b[29] << 16) };
    if(tag === "VP8 ") return { w: (b[26] | b[27] << 8) & 0x3fff, h: (b[28] | b[29] << 8) & 0x3fff };
    if(tag === "VP8L") return { w: 1 + ((b[22] << 8 | b[21]) & 0x3fff), h: 1 + (((b[24] & 0xf) << 10 | b[23] << 2 | (b[22] & 0xc0) >> 6)) };
  }
  return null;
}
/* checks on the file itself (before asking the AI).
   meta = what the page read from the ORIGINAL picked file: {w,h,soft:[...]} */
export function fileForensics(img, meta){
  var soft = editorSignatures(img.bytes);
  if(meta && Array.isArray(meta.soft)) meta.soft.forEach(function(x){ x = String(x).toLowerCase().slice(0, 40); if(EDITOR_RE.test(x) && soft.indexOf(x) < 0) soft.push(x); });
  if(soft.length) return { reason: "edited", detail: soft.join(",") };
  var dims = [imageSize(img.bytes)];
  if(meta && +meta.w > 0 && +meta.h > 0) dims.push({ w: +meta.w, h: +meta.h });
  for(var i = 0; i < dims.length; i++){
    var d = dims[i]; if(!d || !d.w || !d.h) continue;
    /* a full phone screenshot is portrait, about 16:9 .. 21:9 */
    var r = d.h / d.w;
    if(r < 1.55 || r > 2.5) return { reason: "cropped", detail: d.w + "x" + d.h };
  }
  return null;
}
function hm(s){
  var m = /(\d{1,2})\s*[:.]\s*(\d{2})/.exec(toLatinDigits(s || ""));
  if(!m) return null;
  var h = +m[1], mi = +m[2];
  if(h > 23 || mi > 59) return null;
  return h * 60 + mi;
}
/* minutes since the transfer (Cairo time) or null if the date/time can't be read.
   The receipt may use a 12-hour clock ("4:15 PM" / "04:15 \u0645"): try both
   halves of the day when AM/PM isn't clear and keep the most plausible one. */
function transferAgeMin(date, time){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return null;
  var t = hm(time); if(t == null) return null;
  var s = toLatinDigits(time).toLowerCase();
  var pm = /pm|\u0645|\u0645\u0633\u0627\u0621/.test(s), am = /am|\u0635|\u0635\u0628\u0627\u062d/.test(s);
  var cands = [t];
  if(t < 720){ if(pm) cands = [t + 720]; else if(!am) cands.push(t + 720); }
  var best = null;
  cands.forEach(function(c){
    var hh = String(Math.floor(c / 60) % 24).padStart(2, "0"), mm = String(c % 60).padStart(2, "0");
    var at = Date.parse(date + "T" + hh + ":" + mm + ":00+02:00");
    if(!at) return;
    var age = (Date.now() - at) / 60000;
    if(best == null || (age >= -75 && (best < -75 || age < best))) best = age;
  });
  return best;
}

/* admin diagnostics: same decision from an already-read receipt */
export async function checkReceiptFromJson(env, r){
  return pickRecipient(env, r || {});
}

/* full check -> { status:"ok"|"fail"|"manual", reason, amount, recipient, reference, provider, date } */
export async function checkReceipt(env, img, expectedTotal, meta){
  var hash = await sha256Bytes(img.bytes);
  var usedImg = await env.STORE_KV.get("pimg:" + hash);
  if(usedImg) return { status:"fail", reason:"reused", hash: hash };
  var fz = fileForensics(img, meta);
  if(fz) return { status:"fail", reason: fz.reason, detail: fz.detail, hash: hash };

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
    time: String(r.time || "").slice(0, 8),
    statusBarTime: String(r.status_bar_time || "").slice(0, 8),
    model: r._model,
    variant: rr.variant
  };
  function fail(reason){ res.status = "fail"; res.reason = reason; return res; }

  if(r.is_receipt === false) return fail("not_receipt");
  if(r.success === false) return fail("not_success");
  if(r.edited === true){ res.detail = String(r.edit_reason || "").slice(0, 160); return fail("edited"); }
  var pick = pickRecipient(env, r);
  res.recipient = pick.recipient || res.recipient;
  if(!pick.ok) return fail(pick.reason);
  if(res.amount == null) return fail("no_amount");
  if(res.amount + 1 < (+expectedTotal || 0)) return fail("low_amount");
  if(/^\d{4}-\d{2}-\d{2}$/.test(res.date)){
    var t = Date.parse(res.date + "T23:59:59+02:00");
    if(t && Date.now() - t > MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return fail("old");
  }
  /* the transfer must be recent: pay, then upload the screenshot right away */
  var age = transferAgeMin(res.date, res.time);
  if(age != null){
    if(age < -75) return fail("edited");
    if(age > MAX_AGE_MIN + 60) return fail("stale");
  }
  /* the phone clock in the status bar is taken AFTER the transfer (12h or 24h clock) */
  var sb = hm(res.statusBarTime), tt = hm(res.time);
  if(sb != null && tt != null){
    var diff = ((sb - tt) % 720 + 720) % 720;
    if(diff > 240) return fail("edited");
  }
  /* لازم الإيصال يبان فيه الرقم المرجعي للعملية - من غيره الإيصال مرفوض */
  var ref = normRef(res.reference);
  if(ref.length < 6 || !/\d/.test(ref)) return fail("no_reference");
  var usedRef = await env.STORE_KV.get("pref:" + ref);
  if(usedRef) return fail("reused");
  res.status = "ok";
  return res;
}
