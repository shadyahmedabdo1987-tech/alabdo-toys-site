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

s, d = api('GET', '/v1/apps?filter[bundleId]=com.shadyahmed.raseed')
aid = d['data'][0]['id']; log('APP', aid)
terr = [t['id'] for t in all_pages('/v1/territories?limit=200')]
log('TERRITORIES', len(terr))
existing = {x['attributes']['productId']: x for x in all_pages(f'/v1/apps/{aid}/inAppPurchasesV2?limit=200')}
log('EXISTING', list(existing))

ITEMS = [
    {'pid': 'com.shadyahmed.raseed.full', 'name': 'Raseed Full Version', 'free': False,
     'loc': {'ar-SA': ('النسخة الكاملة', 'افتح كل مميزات رصيد بدفعة واحدة'), 'en-US': ('Full Version', 'Unlock everything in Raseed, one payment')},
     'note': 'One-time purchase that unlocks adding and editing after the free 30-day trial. To see it: Settings > Full version, or try to add an expense after the trial. Restore purchase is on the same screen.'},
    {'pid': 'com.shadyahmed.raseed.trial30', 'name': '30-day Trial', 'free': True,
     'loc': {'ar-SA': ('تجربة ٣٠ يوم', 'جرّب النسخة الكاملة ٣٠ يوم مجاناً'), 'en-US': ('30-day Trial', 'Try the full version free for 30 days')},
     'note': 'Free (price tier 0) non-consumable that starts the 30-day free trial, per guideline 3.1.1. Shown on the "Try the full version free for 30 days" screen (Home banner or Settings > Full version). Nothing is charged.'},
]
shot = open(os.path.join(HERE, 'iap_review.png'), 'rb').read()

for it in ITEMS:
    iap = existing.get(it['pid'])
    if not iap:
        s, d = api('POST', '/v2/inAppPurchases', {'data': {'type': 'inAppPurchases', 'attributes': {
            'name': it['name'], 'productId': it['pid'], 'inAppPurchaseType': 'NON_CONSUMABLE', 'reviewNote': it['note'], 'familySharable': False},
            'relationships': {'app': {'data': {'type': 'apps', 'id': aid}}}}})
        ok('CREATE ' + it['pid'], s, d); iap = d.get('data')
    if not iap: continue
    iid = iap['id']; log('IAP', it['pid'], iid, iap['attributes'].get('state'))

    s, d = api('GET', f'/v2/inAppPurchases/{iid}/inAppPurchaseLocalizations')
    have = {x['attributes']['locale'] for x in d.get('data', [])}
    for loc, (n, desc) in it['loc'].items():
        if loc in have: continue
        ok('  LOC ' + loc, *api('POST', '/v1/inAppPurchaseLocalizations', {'data': {'type': 'inAppPurchaseLocalizations',
            'attributes': {'locale': loc, 'name': n, 'description': desc}, 'relationships': {'inAppPurchaseV2': {'data': {'type': 'inAppPurchases', 'id': iid}}}}}))

    s, d = api('GET', f'/v2/inAppPurchases/{iid}/iapPriceSchedule')
    if s < 300 and d.get('data'): log('  PRICE exists')
    else:
        pts = all_pages(f'/v2/inAppPurchases/{iid}/pricePoints?filter[territory]=EGY&limit=200')
        if pts:
            best = min(pts, key=lambda p: abs(float(p['attributes']['customerPrice']) - (0 if it['free'] else TARGET_EGP)))
            log('  EGY_PRICE', best['attributes']['customerPrice'])
            ok('  PRICE', *api('POST', '/v1/inAppPurchasePriceSchedules', {'data': {'type': 'inAppPurchasePriceSchedules', 'relationships': {
                'inAppPurchase': {'data': {'type': 'inAppPurchases', 'id': iid}}, 'baseTerritory': {'data': {'type': 'territories', 'id': 'EGY'}},
                'manualPrices': {'data': [{'type': 'inAppPurchasePrices', 'id': '${p0}'}]}}},
                'included': [{'type': 'inAppPurchasePrices', 'id': '${p0}', 'attributes': {'startDate': None},
                              'relationships': {'inAppPurchasePricePoint': {'data': {'type': 'inAppPurchasePricePoints', 'id': best['id']}}}}]}))
        else: log('  NO_PRICE_POINTS')

    s, d = api('GET', f'/v2/inAppPurchases/{iid}/inAppPurchaseAvailability')
    if s < 300 and d.get('data'): log('  AVAIL exists')
    else:
        ok('  AVAIL', *api('POST', '/v1/inAppPurchaseAvailabilities', {'data': {'type': 'inAppPurchaseAvailabilities', 'attributes': {'availableInNewTerritories': True},
            'relationships': {'inAppPurchase': {'data': {'type': 'inAppPurchases', 'id': iid}},
                              'availableTerritories': {'data': [{'type': 'territories', 'id': t} for t in terr]}}}}))

    s, d = api('GET', f'/v2/inAppPurchases/{iid}/appStoreReviewScreenshot')
    if s < 300 and d.get('data'): log('  SHOT exists')
    else:
        s, d = api('POST', '/v1/inAppPurchaseAppStoreReviewScreenshots', {'data': {'type': 'inAppPurchaseAppStoreReviewScreenshots',
            'attributes': {'fileName': 'paywall.png', 'fileSize': len(shot)}, 'relationships': {'inAppPurchaseV2': {'data': {'type': 'inAppPurchases', 'id': iid}}}}})
        if ok('  SHOT_RESERVE', s, d):
            sh = d['data']
            for op in sh['attributes']['uploadOperations']:
                r = urllib.request.Request(op['url'], method=op['method'], data=shot[op['offset']: op['offset'] + op['length']],
                                           headers={h['name']: h['value'] for h in op.get('requestHeaders', [])})
                with urllib.request.urlopen(r) as _: pass
            ok('  SHOT_COMMIT', *api('PATCH', f"/v1/inAppPurchaseAppStoreReviewScreenshots/{sh['id']}", {'data': {'type': 'inAppPurchaseAppStoreReviewScreenshots',
                'id': sh['id'], 'attributes': {'uploaded': True, 'sourceFileChecksum': hashlib.md5(shot).hexdigest()}}}))
    s, d = api('GET', f'/v2/inAppPurchases/{iid}')
    log('  STATE', d.get('data', {}).get('attributes', {}).get('state'))
