import { json, requireAdmin } from "../_lib.js";

/* Product photos, stored one by one in KV (key "img:<id>") instead of being
   embedded inside the catalog as huge data: URLs. The catalog then only
   holds short links like "/api/img?id=ab12...", so it downloads in about a
   second, and each photo loads on its own (and is cached by the phone).

   GET  /api/img?id=<id>   public. Returns the image bytes with a long cache
                           lifetime (the id is a hash of the bytes, so a given
                           link never changes content).
   POST /api/img           admin only (X-Admin-User / X-Admin-Pass headers).
                           Body: {data: "data:image/jpeg;base64,..."}.
                           Returns {ok, id, url}.
   (ASCII-only comments on purpose, same as _lib.js.) */

var MAX_BYTES = 4 * 1024 * 1024;

export async function onRequestGet(context){
  var request = context.request, env = context.env;
  var url = new URL(request.url);
  var id = String(url.searchParams.get("id") || "");
  if(!/^[a-f0-9]{16,64}$/.test(id)) return new Response("bad id", { status: 400 });

  var cache = caches.default;
  var hit = await cache.match(request);
  if(hit) return hit;

  var got = await env.STORE_KV.getWithMetadata("img:" + id, { type: "arrayBuffer" });
  if(!got || !got.value) return new Response("not found", { status: 404, headers: { "cache-control": "no-store" } });
  var type = (got.metadata && got.metadata.type) || "image/jpeg";
  var resp = new Response(got.value, {
    headers: {
      "content-type": type,
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*"
    }
  });
  if(context.waitUntil) context.waitUntil(cache.put(request, resp.clone()));
  return resp;
}

export async function onRequestPost({ request, env }){
  var acc = await requireAdmin(request, env);
  if(!acc) return json({ ok:false, error:"unauthorized" }, 401);

  var body;
  try{ body = await request.json(); }catch(e){ return json({ ok:false, error:"bad_json" }, 400); }
  var data = String(body && body.data || "");
  var m = /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+\/=\s]+)$/.exec(data);
  if(!m) return json({ ok:false, error:"bad_image" }, 400);
  var type = m[1] === "image/jpg" ? "image/jpeg" : m[1];

  var bin;
  try{ bin = atob(m[2].replace(/\s+/g, "")); }catch(e){ return json({ ok:false, error:"bad_image" }, 400); }
  if(bin.length > MAX_BYTES) return json({ ok:false, error:"too_big" }, 413);
  var bytes = new Uint8Array(bin.length);
  for(var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  var digest = await crypto.subtle.digest("SHA-256", bytes);
  var id = Array.from(new Uint8Array(digest)).slice(0, 16).map(function(b){ return b.toString(16).padStart(2, "0"); }).join("");

  var exists = await env.STORE_KV.get("img:" + id, { type: "arrayBuffer" });
  if(!exists) await env.STORE_KV.put("img:" + id, bytes.buffer, { metadata: { type: type, size: bytes.length, at: Date.now() } });

  return json({ ok:true, id: id, url: "/api/img?id=" + id });
}
