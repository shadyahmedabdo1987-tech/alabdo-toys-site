# Raseed — create the monthly subscription in App Store Connect (group, product, localizations, price ~50 EGP,
# availability, 1-month free trial, review screenshot). Safe to re-run: existing pieces are reused.
import jwt, time, json, os, re, sys, hashlib, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
PRODUCT_ID = 'com.shadyahmed.raseed.pro.monthly'
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

# agreements hint
s, d = api('GET', f'/v1/apps/{aid}/subscriptionGroups?include=subscriptions&limit=50')
groups = d.get('data', []); log('GROUPS', s, len(groups), errs(d)[:300])
grp = next((g for g in groups if g['attributes'].get('referenceName') == 'Raseed Pro'), groups[0] if groups else None)
if not grp:
    s, d = api('POST', '/v1/subscriptionGroups', {'data': {'type': 'subscriptionGroups', 'attributes': {'referenceName': 'Raseed Pro'},
               'relationships': {'app': {'data': {'type': 'apps', 'id': aid}}}}})
    ok('GROUP_CREATE', s, d); grp = d.get('data')
if not grp: sys.exit(1)
gid = grp['id']

s, d = api('GET', f'/v1/subscriptionGroups/{gid}/subscriptionGroupLocalizations')
gl = {x['attributes']['locale']: x for x in d.get('data', [])}
for loc, name in (('ar-SA', 'رصيد بلس'), ('en-US', 'Raseed Plus')):
    if loc not in gl:
        ok('GROUP_LOC ' + loc, *api('POST', '/v1/subscriptionGroupLocalizations', {'data': {'type': 'subscriptionGroupLocalizations',
            'attributes': {'locale': loc, 'name': name, 'customAppName': None}, 'relationships': {'subscriptionGroup': {'data': {'type': 'subscriptionGroups', 'id': gid}}}}}))

s, d = api('GET', f'/v1/subscriptionGroups/{gid}/subscriptions')
sub = next((x for x in d.get('data', []) if x['attributes'].get('productId') == PRODUCT_ID), None)
if not sub:
    s, d = api('POST', '/v1/subscriptions', {'data': {'type': 'subscriptions', 'attributes': {
        'name': 'Raseed Monthly', 'productId': PRODUCT_ID, 'subscriptionPeriod': 'ONE_MONTH', 'familySharable': False, 'groupLevel': 1,
        'reviewNote': 'Monthly subscription that unlocks Raseed after the 30-day in-app free period. Includes a 1-month free trial introductory offer. To see the paywall: Settings > Raseed subscription.'},
        'relationships': {'group': {'data': {'type': 'subscriptionGroups', 'id': gid}}}}})
    ok('SUB_CREATE', s, d); sub = d.get('data')
if not sub: sys.exit(1)
sid = sub['id']; log('SUB', sid, sub['attributes'].get('state'))

s, d = api('GET', f'/v1/subscriptions/{sid}/subscriptionLocalizations')
sl = {x['attributes']['locale']: x for x in d.get('data', [])}
for loc, name, desc in (('ar-SA', 'رصيد بلس — شهري', 'كل مميزات رصيد: المصروفات والمديونيات والبطاقات والتقارير'),
                        ('en-US', 'Raseed Plus — Monthly', 'All Raseed features: expenses, debts, cards and reports')):
    if loc not in sl:
        ok('SUB_LOC ' + loc, *api('POST', '/v1/subscriptionLocalizations', {'data': {'type': 'subscriptionLocalizations',
            'attributes': {'locale': loc, 'name': name, 'description': desc}, 'relationships': {'subscription': {'data': {'type': 'subscriptions', 'id': sid}}}}}))

# territories
terr = [t['id'] for t in all_pages('/v1/territories?limit=200')]
log('TERRITORIES', len(terr))

# availability
s, d = api('GET', f'/v1/subscriptions/{sid}/subscriptionAvailability')
if not (s < 300 and d.get('data')):
    ok('SUB_AVAIL', *api('POST', '/v1/subscriptionAvailabilities', {'data': {'type': 'subscriptionAvailabilities', 'attributes': {'availableInNewTerritories': True},
        'relationships': {'subscription': {'data': {'type': 'subscriptions', 'id': sid}},
                          'availableTerritories': {'data': [{'type': 'territories', 'id': t} for t in terr]}}}}))
else: log('SUB_AVAIL exists')

# price: EGY point closest to TARGET_EGP, then equalize to every territory
s, d = api('GET', f'/v1/subscriptions/{sid}/prices?limit=5')
have_prices = s < 300 and len(d.get('data', [])) > 0
log('PRICES_EXIST', have_prices)
if not have_prices:
    pts = all_pages(f'/v1/subscriptions/{sid}/pricePoints?filter[territory]=EGY&limit=200')
    log('EGY_POINTS', len(pts))
    if pts:
        best = min(pts, key=lambda p: abs(float(p['attributes']['customerPrice']) - TARGET_EGP))
        log('EGY_PRICE', best['attributes']['customerPrice'], 'proceeds', best['attributes'].get('proceeds'))
        ok('PRICE EGY', *api('POST', '/v1/subscriptionPrices', {'data': {'type': 'subscriptionPrices', 'attributes': {'preserveCurrentPrice': False},
            'relationships': {'subscription': {'data': {'type': 'subscriptions', 'id': sid}}, 'subscriptionPricePoint': {'data': {'type': 'subscriptionPricePoints', 'id': best['id']}}}}}))
        eq = all_pages(f"/v1/subscriptionPricePoints/{best['id']}/equalizations?limit=200")
        log('EQUALIZATIONS', len(eq)); n_ok = 0
        for p in eq:
            s2, d2 = api('POST', '/v1/subscriptionPrices', {'data': {'type': 'subscriptionPrices', 'attributes': {'preserveCurrentPrice': False},
                'relationships': {'subscription': {'data': {'type': 'subscriptions', 'id': sid}}, 'subscriptionPricePoint': {'data': {'type': 'subscriptionPricePoints', 'id': p['id']}}}}})
            if s2 < 300: n_ok += 1
            elif n_ok == 0: log('  PRICE_ERR', s2, errs(d2)[:300])
        log('PRICES_SET', n_ok)

# 1-month free trial in every territory
s, d = api('GET', f'/v1/subscriptions/{sid}/introductoryOffers?limit=200')
have_t = {x.get('relationships', {}).get('territory', {}).get('data', {}).get('id') for x in d.get('data', [])} if s < 300 else set()
s, d = api('GET', f'/v1/subscriptions/{sid}/introductoryOffers?include=territory&limit=200')
for x in d.get('data', []):
    t = (x.get('relationships', {}).get('territory', {}).get('data') or {}).get('id')
    if t: have_t.add(t)
log('INTRO_EXISTING', len(have_t))
n_ok = 0
for t in terr:
    if t in have_t: continue
    s2, d2 = api('POST', '/v1/subscriptionIntroductoryOffers', {'data': {'type': 'subscriptionIntroductoryOffers',
        'attributes': {'duration': 'ONE_MONTH', 'offerMode': 'FREE_TRIAL', 'numberOfPeriods': 1},
        'relationships': {'subscription': {'data': {'type': 'subscriptions', 'id': sid}}, 'territory': {'data': {'type': 'territories', 'id': t}}}}})
    if s2 < 300: n_ok += 1
    elif n_ok == 0: log('  INTRO_ERR', t, s2, errs(d2)[:300])
log('INTRO_SET', n_ok)

# review screenshot
s, d = api('GET', f'/v1/subscriptions/{sid}/appStoreReviewScreenshot')
if not (s < 300 and d.get('data')):
    data = open(os.path.join(HERE, 'paywall_ar.png'), 'rb').read()
    s, d = api('POST', '/v1/subscriptionAppStoreReviewScreenshots', {'data': {'type': 'subscriptionAppStoreReviewScreenshots',
        'attributes': {'fileName': 'paywall.png', 'fileSize': len(data)}, 'relationships': {'subscription': {'data': {'type': 'subscriptions', 'id': sid}}}}})
    if ok('REVIEW_SHOT_RESERVE', s, d):
        sh = d['data']
        for op in sh['attributes']['uploadOperations']:
            chunk = data[op['offset']: op['offset'] + op['length']]
            r = urllib.request.Request(op['url'], method=op['method'], data=chunk, headers={h['name']: h['value'] for h in op.get('requestHeaders', [])})
            with urllib.request.urlopen(r) as _: pass
        ok('REVIEW_SHOT_COMMIT', *api('PATCH', f"/v1/subscriptionAppStoreReviewScreenshots/{sh['id']}", {'data': {'type': 'subscriptionAppStoreReviewScreenshots', 'id': sh['id'],
            'attributes': {'uploaded': True, 'sourceFileChecksum': hashlib.md5(data).hexdigest()}}}))
else: log('REVIEW_SHOT exists')

s, d = api('GET', f'/v1/subscriptions/{sid}')
log('FINAL_STATE', d.get('data', {}).get('attributes', {}).get('state'))
