# Raseed — create the two non-consumable in-app purchases in App Store Connect:
#   com.shadyahmed.raseed.full     "Full version"  ~50 EGP (one time)
#   com.shadyahmed.raseed.trial30  "30-day Trial"  free (Apple guideline 3.1.1 for time-based free trials)
# Localizations, price, availability, review screenshot. Safe to re-run.
import jwt, time, json, os, re, sys, hashlib, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET_EGP = float(os.environ.get('TARGET_EGP', '50'))
kid = re.sub(r'[^A-Za-z0-9]', '', os.environ['K1']); iss = re.sub(r'[^A-Za-z0-9-]', '', os.environ['K2'])
key = open(os.environ['RUNNER_TEMP'] + '/k.p8').read()
_tok = [None, 0]
def tok():
    now = int(time.time())
    if now - _tok[1] > 600:
        _tok[0] = jwt.encode({'iss': iss, 'iat': now, 'exp': now + 1100, 'aud': 'appstoreconnect-v1'}, key, algorithm='ES256', headers={'kid': kid, 'typ': 'JWT'}); _tok[1] = now
    return _tok[0]
def api(method, path, body=None):
    url = path if path.startswith('http') else 'https://api.appstoreconnect.apple.com' + path
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer ' + tok(), 'Content-Type': 'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'{}')
        except urllib.error.HTTPError as e:
            raw = e.read()
            if e.code in (429, 500, 503) and attempt < 2: time.sleep(5); continue
            try: return e.code, json.loads(raw or b'{}')
            except Exception: return e.code, {'errors': [{'detail': raw[:300].decode('utf-8', 'ignore')}]}
def errs(d): return ' | '.join(f"{e.get('code','')}: {e.get('detail') or e.get('title') or ''} {json.dumps(e.get('source',''))}" for e in d.get('errors', []))
def log(*a): print(*a, flush=True)
def ok(tag, s, d): log(tag, s, 'OK' if s < 300 else errs(d)[:700]); return s < 300
def all_pages(path):
    out = []; url = path
    while url:
        s, d = api('GET', url)
        if s >= 300: log('GET_FAIL', path, s, errs(d)[:300]); break
        out += d.get('data', []); url = d.get('links', {}).get('next')
    return out

