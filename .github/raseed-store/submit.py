# Raseed — prepare App Store version (metadata, screenshots, pricing, age rating) and submit for review.
import jwt, time, json, os, re, sys, hashlib, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
M = json.load(open(os.path.join(HERE, 'meta.json'), encoding='utf-8'))
SUBMIT = os.environ.get('DO_SUBMIT', '1') == '1'
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
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw or b'{}')
        except Exception: return e.code, {'errors': [{'detail': raw[:300].decode('utf-8', 'ignore')}]}
def errs(d): return ' | '.join(f"{e.get('code','')}: {e.get('detail') or e.get('title') or ''} {json.dumps(e.get('source',''))}" for e in d.get('errors', []))
def log(*a): print(*a, flush=True)
def ok(tag, s, d): log(tag, s, 'OK' if s < 300 else errs(d)[:900]); return s < 300

s, d = api('GET', '/v1/apps?filter[bundleId]=com.shadyahmed.raseed')
app = d['data'][0]; aid = app['id']; log('APP', aid)
VER = M['version']

# ---------- 1. build ----------
build = None
for i in range(40):
    s, d = api('GET', f'/v1/builds?filter[app]={aid}&filter[preReleaseVersion.version]={VER}&sort=-uploadedDate&limit=5')
    bs = [b for b in d.get('data', []) if not b['attributes'].get('expired')]
    if bs and bs[0]['attributes'].get('processingState') == 'VALID':
        build = bs[0]; break
    log('waiting build', VER, [b['attributes'].get('processingState') for b in bs]); time.sleep(30)
if not build: log('NO VALID BUILD'); sys.exit(1)
log('BUILD', build['attributes']['version'])
if build['attributes'].get('usesNonExemptEncryption') is None:
    ok('ENCRYPTION', *api('PATCH', '/v1/builds/' + build['id'], {'data': {'type': 'builds', 'id': build['id'], 'attributes': {'usesNonExemptEncryption': False}}}))

# ---------- 2. version ----------
s, d = api('GET', f'/v1/apps/{aid}/appStoreVersions?filter[platform]=IOS&limit=20')
editable = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY', 'WAITING_FOR_REVIEW']
vs = [v for v in d.get('data', []) if v['attributes'].get('appStoreState') in editable or v['attributes'].get('appVersionState') in ('PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY')]
for v in d.get('data', []): log('  version', v['attributes'].get('versionString'), v['attributes'].get('appStoreState'), v['attributes'].get('appVersionState'))
first_release = len(d.get('data', [])) <= 1
if vs: ver = vs[0]
else:
    s, d = api('POST', '/v1/appStoreVersions', {'data': {'type': 'appStoreVersions', 'attributes': {'platform': 'IOS', 'versionString': VER},
                                                        'relationships': {'app': {'data': {'type': 'apps', 'id': aid}}}}})
    ok('CREATE_VERSION', s, d); ver = d['data']
vid = ver['id']
ok('VERSION_ATTRS', *api('PATCH', f'/v1/appStoreVersions/{vid}', {'data': {'type': 'appStoreVersions', 'id': vid,
   'attributes': {'versionString': VER, 'copyright': M['copyright'], 'releaseType': 'AFTER_APPROVAL'}}}))
ok('ATTACH_BUILD', *api('PATCH', f'/v1/appStoreVersions/{vid}/relationships/build', {'data': {'type': 'builds', 'id': build['id']}}))

# ---------- 3. app info: category, localizations, age rating ----------
ok('CONTENT_RIGHTS', *api('PATCH', f'/v1/apps/{aid}', {'data': {'type': 'apps', 'id': aid, 'attributes': {'contentRightsDeclaration': 'DOES_NOT_USE_THIRD_PARTY_CONTENT'}}}))
s, d = api('GET', f'/v1/apps/{aid}/appInfos')
infos = d.get('data', [])
info = next((x for x in infos if x['attributes'].get('appStoreState') not in ('READY_FOR_SALE', 'READY_FOR_DISTRIBUTION')), infos[0])
iid = info['id']; log('APPINFO', iid, info['attributes'].get('appStoreState') or info['attributes'].get('state'))
ok('CATEGORY', *api('PATCH', f'/v1/appInfos/{iid}', {'data': {'type': 'appInfos', 'id': iid, 'relationships': {
    'primaryCategory': {'data': {'type': 'appCategories', 'id': 'FINANCE'}},
    'secondaryCategory': {'data': {'type': 'appCategories', 'id': 'PRODUCTIVITY'}}}}}))
s, d = api('GET', f'/v1/appInfos/{iid}/appInfoLocalizations')
have = {x['attributes']['locale']: x for x in d.get('data', [])}
log('INFO_LOCALES', list(have))
for loc, L in M['loc'].items():
    attrs = {'name': L['name'], 'subtitle': L['subtitle'], 'privacyPolicyUrl': M['privacyUrl']}
    if loc in have:
        s, d = api('PATCH', f"/v1/appInfoLocalizations/{have[loc]['id']}", {'data': {'type': 'appInfoLocalizations', 'id': have[loc]['id'], 'attributes': attrs}})
    else:
        s, d = api('POST', '/v1/appInfoLocalizations', {'data': {'type': 'appInfoLocalizations', 'attributes': dict(attrs, locale=loc),
                                                                 'relationships': {'appInfo': {'data': {'type': 'appInfos', 'id': iid}}}}})
    if not ok('INFO_LOC ' + loc, s, d) and 'name' in errs(d).lower():
        attrs['name'] = L['name'] + (' App' if loc.startswith('en') else ' للمصروفات')
        if loc in have: ok('INFO_LOC_RETRY ' + loc, *api('PATCH', f"/v1/appInfoLocalizations/{have[loc]['id']}", {'data': {'type': 'appInfoLocalizations', 'id': have[loc]['id'], 'attributes': attrs}}))
        else: ok('INFO_LOC_RETRY ' + loc, *api('POST', '/v1/appInfoLocalizations', {'data': {'type': 'appInfoLocalizations', 'attributes': dict(attrs, locale=loc), 'relationships': {'appInfo': {'data': {'type': 'appInfos', 'id': iid}}}}}))

# age rating — everything none / false
s, d = api('GET', f'/v1/appInfos/{iid}/ageRatingDeclaration')
if s < 300 and d.get('data'):
    ar = d['data']; cur = ar['attributes']; log('AGE_KEYS', sorted(cur))
    BOOL = {'gambling', 'unrestrictedWebAccess', 'lootBox', 'messagingAndChat', 'parentalControls', 'ageAssurance', 'userGeneratedContent',
            'advertising', 'healthOrWellnessTopics', 'seventeenPlus', 'gamblingAndContests', 'kidsAgeBand', 'socialMedia', 'socialMediaAgeRestricted'}
    SKIP = {'gracRatingClassificationNumber', 'kidsAgeBand', 'developerAgeRatingInfoUrl', 'ageRatingOverride', 'ageRatingOverrideV2', 'koreaAgeRatingOverride', 'seventeenPlus', 'gamblingAndContests'}
    attrs = {}
    for k, v in cur.items():
        if k in SKIP: continue
        if isinstance(v, bool) or k in BOOL: attrs[k] = False
        else: attrs[k] = 'NONE'
    for tries in range(6):
        s, d2 = api('PATCH', f"/v1/ageRatingDeclarations/{ar['id']}", {'data': {'type': 'ageRatingDeclarations', 'id': ar['id'], 'attributes': attrs}})
        if s < 300: log('AGE_RATING OK'); break
        log('AGE_RATING', s, errs(d2)[:600])
        bad = [e.get('source', {}).get('pointer', '').split('/')[-1] for e in d2.get('errors', [])]
        bad = [b for b in bad if b in attrs]
        if not bad: break
        for b in bad:
            attrs[b] = False if attrs[b] == 'NONE' else 'NONE'
else: log('AGE_GET', s, errs(d))

# ---------- 4. version localizations ----------
s, d = api('GET', f'/v1/appStoreVersions/{vid}/appStoreVersionLocalizations')
vh = {x['attributes']['locale']: x for x in d.get('data', [])}
log('VER_LOCALES', list(vh))
vloc = {}
for loc, L in M['loc'].items():
    attrs = {'description': L['description'], 'keywords': L['keywords'], 'promotionalText': L['promo'], 'supportUrl': M['supportUrl'], 'marketingUrl': M['supportUrl']}
    if loc in vh:
        s, d = api('PATCH', f"/v1/appStoreVersionLocalizations/{vh[loc]['id']}", {'data': {'type': 'appStoreVersionLocalizations', 'id': vh[loc]['id'], 'attributes': attrs}})
        vloc[loc] = vh[loc]['id']
    else:
        s, d = api('POST', '/v1/appStoreVersionLocalizations', {'data': {'type': 'appStoreVersionLocalizations', 'attributes': dict(attrs, locale=loc),
                                                                         'relationships': {'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': vid}}}}})
        if s < 300: vloc[loc] = d['data']['id']
    ok('VER_LOC ' + loc, s, d)
    if loc in vloc and not first_release:
        ok('WHATS_NEW ' + loc, *api('PATCH', f"/v1/appStoreVersionLocalizations/{vloc[loc]}", {'data': {'type': 'appStoreVersionLocalizations', 'id': vloc[loc], 'attributes': {'whatsNew': L['whatsNew']}}}))

# ---------- 5. screenshots ----------
def upload_shots(lid, folder):
    s, d = api('GET', f'/v1/appStoreVersionLocalizations/{lid}/appScreenshotSets')
    sets = {x['attributes']['screenshotDisplayType']: x for x in d.get('data', [])}
    st = sets.get('APP_IPHONE_67')
    if not st:
        s, d = api('POST', '/v1/appScreenshotSets', {'data': {'type': 'appScreenshotSets', 'attributes': {'screenshotDisplayType': 'APP_IPHONE_67'},
                   'relationships': {'appStoreVersionLocalization': {'data': {'type': 'appStoreVersionLocalizations', 'id': lid}}}}})
        if not ok('  SET_CREATE', s, d): return
        st = d['data']
    s, d = api('GET', f"/v1/appScreenshotSets/{st['id']}/appScreenshots")
    for x in d.get('data', []):
        api('DELETE', f"/v1/appScreenshots/{x['id']}")
    for name in M['order']:
        p = os.path.join(HERE, folder, name + '.png'); data = open(p, 'rb').read()
        s, d = api('POST', '/v1/appScreenshots', {'data': {'type': 'appScreenshots', 'attributes': {'fileName': name + '.png', 'fileSize': len(data)},
                   'relationships': {'appScreenshotSet': {'data': {'type': 'appScreenshotSets', 'id': st['id']}}}}})
        if not ok('  SHOT_RESERVE ' + name, s, d): continue
        sh = d['data']
        for op in sh['attributes']['uploadOperations']:
            chunk = data[op['offset']: op['offset'] + op['length']]
            req = urllib.request.Request(op['url'], method=op['method'], data=chunk, headers={h['name']: h['value'] for h in op.get('requestHeaders', [])})
            with urllib.request.urlopen(req) as r: pass
        ok('  SHOT_COMMIT ' + name, *api('PATCH', f"/v1/appScreenshots/{sh['id']}", {'data': {'type': 'appScreenshots', 'id': sh['id'],
            'attributes': {'uploaded': True, 'sourceFileChecksum': hashlib.md5(data).hexdigest()}}}))
for loc, lid in vloc.items():
    log('SCREENSHOTS', loc); upload_shots(lid, 'ar' if loc.startswith('ar') else 'en')

# ---------- 6. review details (copy contact from the other app) ----------
contact = None
s, d = api('GET', '/v1/apps?limit=20')
for a in d.get('data', []):
    if a['id'] == aid: continue
    s2, d2 = api('GET', f"/v1/apps/{a['id']}/appStoreVersions?limit=5")
    for v in d2.get('data', []):
        s3, d3 = api('GET', f"/v1/appStoreVersions/{v['id']}/appStoreReviewDetail")
        if s3 < 300 and d3.get('data') and d3['data']['attributes'].get('contactEmail'):
            contact = d3['data']['attributes']; break
    if contact: break
log('CONTACT_FOUND', bool(contact))
rattrs = {'demoAccountRequired': False, 'notes': M['reviewNotes']}
if contact:
    for k in ('contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail'): rattrs[k] = contact.get(k)
s, d = api('GET', f'/v1/appStoreVersions/{vid}/appStoreReviewDetail')
if s < 300 and d.get('data'):
    ok('REVIEW_DETAIL', *api('PATCH', f"/v1/appStoreReviewDetails/{d['data']['id']}", {'data': {'type': 'appStoreReviewDetails', 'id': d['data']['id'], 'attributes': rattrs}}))
else:
    ok('REVIEW_DETAIL', *api('POST', '/v1/appStoreReviewDetails', {'data': {'type': 'appStoreReviewDetails', 'attributes': rattrs,
        'relationships': {'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': vid}}}}}))

# ---------- 7. price: free ----------
s, d = api('GET', f'/v1/apps/{aid}/appPriceSchedule?include=manualPrices')
log('PRICE_SCHEDULE', s, 'exists' if s < 300 and d.get('data') else errs(d)[:200])
if not (s < 300 and d.get('included')):
    s, d = api('GET', f'/v1/apps/{aid}/appPricePoints?filter[territory]=USA&limit=200')
    free = next((p for p in d.get('data', []) if float(p['attributes'].get('customerPrice') or 1) == 0), None)
    log('FREE_POINT', bool(free))
    if free:
        ok('PRICE_FREE', *api('POST', '/v1/appPriceSchedules', {'data': {'type': 'appPriceSchedules', 'relationships': {
            'app': {'data': {'type': 'apps', 'id': aid}}, 'baseTerritory': {'data': {'type': 'territories', 'id': 'USA'}},
            'manualPrices': {'data': [{'type': 'appPrices', 'id': '${p0}'}]}}},
            'included': [{'type': 'appPrices', 'id': '${p0}', 'attributes': {'startDate': None},
                          'relationships': {'appPricePoint': {'data': {'type': 'appPricePoints', 'id': free['id']}}}}]}))

# ---------- 8. availability: all territories ----------
s, d = api('GET', f'/v1/apps/{aid}/appAvailabilityV2')
log('AVAILABILITY', s, 'exists' if s < 300 and d.get('data') else errs(d)[:200])
if not (s < 300 and d.get('data')):
    terr = []; url = '/v1/territories?limit=200'
    while url:
        s, d = api('GET', url); terr += [t['id'] for t in d.get('data', [])]; url = d.get('links', {}).get('next')
    log('TERRITORIES', len(terr))
    inc = [{'type': 'territoryAvailabilities', 'id': f'${{t{i}}}', 'attributes': {'available': True},
            'relationships': {'territory': {'data': {'type': 'territories', 'id': t}}}} for i, t in enumerate(terr)]
    ok('AVAILABILITY_SET', *api('POST', '/v2/appAvailabilities', {'data': {'type': 'appAvailabilities', 'attributes': {'availableInNewTerritories': True},
        'relationships': {'app': {'data': {'type': 'apps', 'id': aid}}, 'territoryAvailabilities': {'data': [{'type': 'territoryAvailabilities', 'id': x['id']} for x in inc]}}},
        'included': inc}))

# ---------- 9. submit ----------
if SUBMIT:
    s, d = api('GET', f'/v1/reviewSubmissions?filter[app]={aid}&filter[platform]=IOS&limit=10')
    for r in d.get('data', []): log('  existing submission', r['id'], r['attributes'].get('state'))
    sub = next((r for r in d.get('data', []) if r['attributes'].get('state') == 'READY_FOR_REVIEW'), None)
    if not sub:
        s, d = api('POST', '/v1/reviewSubmissions', {'data': {'type': 'reviewSubmissions', 'attributes': {'platform': 'IOS'},
                   'relationships': {'app': {'data': {'type': 'apps', 'id': aid}}}}})
        ok('SUBMISSION_CREATE', s, d); sub = d.get('data')
    if sub:
        s, d = api('GET', f"/v1/reviewSubmissions/{sub['id']}/items")
        if not d.get('data'):
            ok('SUBMISSION_ITEM', *api('POST', '/v1/reviewSubmissionItems', {'data': {'type': 'reviewSubmissionItems', 'relationships': {
                'reviewSubmission': {'data': {'type': 'reviewSubmissions', 'id': sub['id']}},
                'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': vid}}}}}))
        s, d = api('PATCH', f"/v1/reviewSubmissions/{sub['id']}", {'data': {'type': 'reviewSubmissions', 'id': sub['id'], 'attributes': {'submitted': True}}})
        ok('SUBMIT_FOR_REVIEW', s, d)
        if s < 300: log('STATE', d['data']['attributes'].get('state'))
s, d = api('GET', f'/v1/appStoreVersions/{vid}')
log('FINAL_VERSION_STATE', d.get('data', {}).get('attributes', {}).get('appStoreState'), d.get('data', {}).get('attributes', {}).get('appVersionState'))
