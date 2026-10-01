import { getList, saveList } from "./_lib.js";

/* Customer notifications ("the bell"): admin replies to contact-us inquiries
   and "back in stock" messages. Product-request replies live on the request
   itself (see api/product-requests.js); api/notifications.js merges both.
   A note is matched to a customer by account id, or by the last 10 digits of
   the phone number they typed (so a guest who registers later with the same
   number still sees the reply).
   (ASCII-only comments on purpose, same as _lib.js.) */

var KEY = "custNotes";
var MAX_KEEP = 1500;

export function phoneTail(p){ return String(p || "").replace(/\D/g, "").slice(-10); }

export function noteMatches(n, acc){
  var id = String(acc.identifier || "").toLowerCase();
  if(n.customerId && String(n.customerId).toLowerCase() === id) return true;
  var tail = phoneTail(acc.identifier);
  return !!(tail && tail.length >= 9 && n.phoneTail && n.phoneTail === tail);
}

export async function getNotes(env){ return getList(env, KEY); }
export async function saveNotes(env, list){ return saveList(env, KEY, list); }

export async function addNote(env, note){
  var list = await getNotes(env);
  var item = Object.assign({
    id: "nt_" + Date.now().toString(36) + Math.floor(Math.random() * 999),
    at: Date.now(),
    seen: false
  }, note);
  list.push(item);
  if(list.length > MAX_KEEP) list = list.slice(list.length - MAX_KEEP);
  await saveNotes(env, list);
  return item;
}

export async function hasAccountFor(env, phone, customerId){
  var tail = phoneTail(phone);
  var customers = await getList(env, "customers");
  return customers.some(function(c){
    if(customerId && String(c.identifier || "").toLowerCase() === String(customerId).toLowerCase()) return true;
    return tail && phoneTail(c.identifier) === tail;
  });
}
