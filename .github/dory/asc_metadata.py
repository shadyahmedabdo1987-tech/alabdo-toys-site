import jwt, time, json, os, re, hashlib, urllib.request, urllib.error
kid = re.sub(r'[^A-Za-z0-9]', '', os.environ['K1']); iss = re.sub(r'[^A-Za-z0-9-]', '', os.environ['K2'])
key = open(os.environ['RUNNER_TEMP'] + '/k.p8').read()
now = int(time.time())
TOK = jwt.encode({'iss': iss, 'iat': now, 'exp': now + 1150, 'aud': 'appstoreconnect-v1'}, key, algorithm='ES256', headers={'kid': kid, 'typ': 'JWT'})
def api(method, path, body=None):
    url = path if path.startswith('http') else 'https://api.appstoreconnect.apple.com' + path
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
          headers={'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
def errs(d): return '; '.join((e.get('detail') or e.get('title') or '') for e in d.get('errors', []))[:400]
def ok(tag, s, d): print(tag, s, errs(d))

s, d = api('GET', '/v1/apps?filter[bundleId]=com.alabdo.dory'); aid = d['data'][0]['id']
print('APP', aid)

# --- Replace the version waiting for review: pull it back first (edits are locked while it waits)
if os.environ.get('SUBMIT') == 'replace':
    # Only pull the old one back once the new build is ready to take its place.
    want = os.environ.get('VERSION') or ''
    s, d = api('GET', f'/v1/builds?filter[app]={aid}&sort=-uploadedDate&limit=5&include=preReleaseVersion')
    pre = {x['id']: x['attributes'].get('version') for x in d.get('included', [])}
    ready = [b for b in d.get('data', []) if b['attributes'].get('processingState') == 'VALID'
             and pre.get(((b.get('relationships') or {}).get('preReleaseVersion') or {}).get('data', {}).get('id')) == want]
    if not ready:
        print('REPLACE_WAIT build', want, 'not processed yet — nothing changed')
        raise SystemExit(0)
    s, d = api('GET', f'/v1/apps/{aid}/reviewSubmissions?filter[platform]=IOS&filter[state]=WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES')
    for x in d.get('data', []):
        s2, d2 = api('PATCH', f"/v1/reviewSubmissions/{x['id']}", {'data': {'type': 'reviewSubmissions', 'id': x['id'], 'attributes': {'canceled': True}}})
        ok('CANCEL ' + x['attributes'].get('state', ''), s2, d2)
    for i in range(30):
        s, d = api('GET', f'/v1/apps/{aid}/reviewSubmissions?filter[platform]=IOS&filter[state]=WAITING_FOR_REVIEW,IN_REVIEW,CANCELING,UNRESOLVED_ISSUES')
        if not d.get('data'): break
        time.sleep(10)
    print('CANCEL_DONE', i)
    os.environ['SUBMIT'] = 'yes'
s, d = api('PATCH', f'/v1/apps/{aid}', {'data': {'type': 'apps', 'id': aid, 'attributes': {'contentRightsDeclaration': 'DOES_NOT_USE_THIRD_PARTY_CONTENT'}}}); ok('CONTENT_RIGHTS', s, d)

# --- App info: categories, subtitle, privacy URL, age rating
s, d = api('GET', f'/v1/apps/{aid}/appInfos')
info = [x for x in d['data'] if x['attributes'].get('appStoreState') not in ('READY_FOR_SALE',)][0]; iid = info['id']
s, d = api('PATCH', f'/v1/appInfos/{iid}', {'data': {'type': 'appInfos', 'id': iid, 'relationships': {
    'primaryCategory': {'data': {'type': 'appCategories', 'id': 'FINANCE'}},
    'secondaryCategory': {'data': {'type': 'appCategories', 'id': 'PRODUCTIVITY'}}}}}); ok('CATEGORIES', s, d)
s, d = api('GET', f'/v1/appInfos/{iid}/appInfoLocalizations')
for loc in d['data']:
    if loc['attributes']['locale'] == 'ar-SA':
        s2, d2 = api('PATCH', f"/v1/appInfoLocalizations/{loc['id']}", {'data': {'type': 'appInfoLocalizations', 'id': loc['id'], 'attributes': {
            'subtitle': 'نظّم الأقساط والأدوار والقبض', 'privacyPolicyUrl': 'https://alabdo-toys.com/dory/privacy.html'}}}); ok('APPINFO_AR', s2, d2)
s, d = api('GET', f'/v1/appInfos/{iid}/ageRatingDeclaration')
if d.get('data'):
    arid = d['data']['id']
    BOOL = ['advertising', 'gambling', 'lootBox', 'messagingAndChat', 'parentalControls', 'ageAssurance', 'socialMedia',
            'unrestrictedWebAccess', 'userGeneratedContent', 'healthOrWellnessTopics']
    STR = ['alcoholTobaccoOrDrugUseOrReferences', 'contests', 'gamblingSimulated', 'gunsOrOtherWeapons', 'medicalOrTreatmentInformation',
           'profanityOrCrudeHumor', 'sexualContentGraphicAndNudity', 'sexualContentOrNudity', 'horrorOrFearThemes',
           'matureOrSuggestiveThemes', 'violenceCartoonOrFantasy', 'violenceRealisticProlongedGraphicOrSadistic', 'violenceRealistic']
    have = d['data']['attributes']
    attrs = {k: False for k in BOOL if k in have}
    attrs.update({k: 'NONE' for k in STR if k in have})
    for _ in range(4):
        s, d = api('PATCH', f'/v1/ageRatingDeclarations/{arid}', {'data': {'type': 'ageRatingDeclarations', 'id': arid, 'attributes': attrs}})
        if s < 300: break
        fixed = False
        for e in d.get('errors', []):
            ptr = (e.get('source') or {}).get('pointer', '').split('/')[-1]; det = e.get('detail', '')
            if ptr in attrs and 'Expected a STRING' in det: attrs[ptr] = 'NONE'; fixed = True
            elif ptr in attrs and 'Expected a BOOLEAN' in det: attrs[ptr] = False; fixed = True
            elif ptr in attrs: attrs.pop(ptr); fixed = True
        if not fixed: break
    ok('AGE_RATING', s, d)
    if s >= 300: print('AGE_ATTRS', attrs)

# --- Price: free
s, d = api('GET', f'/v1/apps/{aid}/appPricePoints?filter[territory]=EGY&limit=1')
if d.get('data'):
    pp = d['data'][0]['id']
    s, d = api('POST', '/v1/appPriceSchedules', {'data': {'type': 'appPriceSchedules', 'relationships': {
        'app': {'data': {'type': 'apps', 'id': aid}}, 'baseTerritory': {'data': {'type': 'territories', 'id': 'EGY'}},
        'manualPrices': {'data': [{'type': 'appPrices', 'id': '${p0}'}]}}},
        'included': [{'type': 'appPrices', 'id': '${p0}', 'attributes': {'startDate': None},
                      'relationships': {'appPricePoint': {'data': {'type': 'appPricePoints', 'id': pp}}}}]})
    ok('PRICE_FREE', s, d)

# --- Version: number, copyright, build, localization, screenshots, review details
s, d = api('GET', f'/v1/apps/{aid}/appStoreVersions?filter[platform]=IOS&limit=5')
for v in d['data']: print('VERSION_STATE', v['attributes'].get('versionString'), v['attributes'].get('appStoreState'), v['attributes'].get('appVersionState'))
editable = [v for v in d['data'] if v['attributes']['appStoreState'] in ('PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED')]
if not editable:
    s, d = api('GET', f'/v1/apps/{aid}/reviewSubmissions?filter[platform]=IOS&limit=5')
    for x in d.get('data', []): print('SUBMISSION', x['id'], x['attributes'].get('state'), x['attributes'].get('submittedDate'))
    print('NOTHING_EDITABLE (the version is with Apple)')
    if os.environ.get('SUBMIT') == 'yes':
        for x in d.get('data', []):
            if x['attributes'].get('state') != 'READY_FOR_REVIEW': continue
            s3, d3 = api('GET', f"/v1/reviewSubmissions/{x['id']}/items")
            for it in d3.get('data', []): print('  ITEM', it['id'], it['attributes'].get('state'))
            s2, d2 = api('PATCH', f"/v1/reviewSubmissions/{x['id']}", {'data': {'type': 'reviewSubmissions', 'id': x['id'], 'attributes': {'submitted': True}}})
            ok('SUBMITTED', s2, d2)
            if s2 >= 300: print('SUBMIT_ERRORS', json.dumps(d2, ensure_ascii=False)[:4000])
    raise SystemExit(0)
ver = editable[0]
vid = ver['id']
VER = os.environ.get('VERSION') or '2.59.0'
s, d = api('GET', f'/v1/builds?filter[app]={aid}&sort=-uploadedDate&limit=5&include=preReleaseVersion')
pre = {x['id']: x['attributes'].get('version') for x in d.get('included', [])}
for b in d.get('data', []): b['attributes']['short'] = pre.get(((b.get('relationships') or {}).get('preReleaseVersion') or {}).get('data', {}).get('id'))
builds = [b for b in d.get('data', []) if b['attributes'].get('processingState') == 'VALID' and b['attributes'].get('short') == VER]
for b in d.get('data', []): print('  build', b['attributes'].get('short'), b['attributes']['version'], b['attributes'].get('processingState'))
vstr = VER
s, d = api('PATCH', f'/v1/appStoreVersions/{vid}', {'data': {'type': 'appStoreVersions', 'id': vid, 'attributes': {
    'versionString': vstr, 'copyright': '2026 Shady Ahmed', 'releaseType': 'AFTER_APPROVAL'}}}); ok('VERSION', s, d)
if builds:
    bid = builds[0]['id']
    api('PATCH', f'/v1/builds/{bid}', {'data': {'type': 'builds', 'id': bid, 'attributes': {'usesNonExemptEncryption': False}}})
    s, d = api('PATCH', f'/v1/appStoreVersions/{vid}/relationships/build', {'data': {'type': 'builds', 'id': bid}}); ok('BUILD ' + builds[0]['attributes']['version'], s, d)
DESC = '''دوري بينظّم الجمعية (الادخار الدوري) من أولها لآخرها، لصاحب الجمعية والأعضاء.

لصاحب الجمعية:
• اعمل جمعية في دقيقة: القسط، والمواعيد (كل شهر أو كل كام شهر)، وعدد الأعضاء.
• ضيف الأعضاء بنفسك أو ابعتلهم كود دعوة يدخلوا بيه.
• رتّب الأدوار بإيدك أو بعجلة القرعة.
• كل الأدوار قدامك أيقونات: الأصفر لسه، والأخضر خلص.
• أكّد الأقساط كاش أو بصورة التحويل، وسجّل تسليم القبض.
• تأجيل قسط لعضو، ودور إضافي، ومبلغ إضافي، وتسريع الجمعية.
• رسايل وتذكيرات للأعضاء، وتقرير كامل للجمعية.

للعضو:
• شوف دورك، والأقساط اللي دفعتها واللي فاضلة.
• دوس "دفعت" وارفق صورة التحويل.
• أكّد إنك استلمت فلوسك لما دورك يجي.

• قفل التطبيق بالبصمة أو بصمة الوش.
• عربي وإنجليزي، فاتح وليلي.

دوري ما بيحوّلش فلوس ولا بيحتفظ بفلوس — هو دفتر الجمعية المنظّم في جيبك.
Powered by Shady Ahmed'''
s, d = api('GET', f'/v1/appStoreVersions/{vid}/appStoreVersionLocalizations')
locs = {x['attributes']['locale']: x['id'] for x in d['data']}
fields = {'description': DESC, 'keywords': 'جمعية,جمعيات,ادخار,أقساط,قسط,دور,قبض,توفير,فلوس,حسابات,دفتر',
          'promotionalText': 'نظّم جمعيتك: الأقساط والأدوار والقبض في مكان واحد، لصاحب الجمعية والأعضاء.',
          'supportUrl': 'https://alabdo-toys.com/dory/privacy.html', 'marketingUrl': 'https://alabdo-toys.com/dory/privacy.html'}
if 'ar-SA' in locs:
    lid = locs['ar-SA']
    s, d = api('PATCH', f'/v1/appStoreVersionLocalizations/{lid}', {'data': {'type': 'appStoreVersionLocalizations', 'id': lid, 'attributes': fields}}); ok('VERSION_AR', s, d)
    # screenshots (6.5" iPhone)
    s, d = api('GET', f'/v1/appStoreVersionLocalizations/{lid}/appScreenshotSets')
    sets = {x['attributes']['screenshotDisplayType']: x['id'] for x in d.get('data', [])}
    if 'APP_IPHONE_65' not in sets:
        s, d = api('POST', '/v1/appScreenshotSets', {'data': {'type': 'appScreenshotSets', 'attributes': {'screenshotDisplayType': 'APP_IPHONE_65'},
               'relationships': {'appStoreVersionLocalization': {'data': {'type': 'appStoreVersionLocalizations', 'id': lid}}}}}); ok('SHOT_SET', s, d)
        sets['APP_IPHONE_65'] = d['data']['id']
    sid = sets['APP_IPHONE_65']
    s, d = api('GET', f'/v1/appScreenshotSets/{sid}/appScreenshots')
    if d.get('data'):
        print('SHOTS already', len(d['data']))
    else:
        for n in (1, 2, 3):
            img = open(f'.github/dory/shots/shot-{n}.png', 'rb').read()
            s, d = api('POST', '/v1/appScreenshots', {'data': {'type': 'appScreenshots', 'attributes': {'fileName': f'shot-{n}.png', 'fileSize': len(img)},
                   'relationships': {'appScreenshotSet': {'data': {'type': 'appScreenshotSets', 'id': sid}}}}})
            if s >= 300: ok('SHOT_RESERVE', s, d); continue
            shid = d['data']['id']
            for op in d['data']['attributes']['uploadOperations']:
                urllib.request.urlopen(urllib.request.Request(op['url'], method=op['method'], data=img[op['offset']:op['offset'] + op['length']],
                                       headers={h['name']: h['value'] for h in op['requestHeaders']})).read()
            s, d = api('PATCH', f'/v1/appScreenshots/{shid}', {'data': {'type': 'appScreenshots', 'id': shid,
                   'attributes': {'uploaded': True, 'sourceFileChecksum': hashlib.md5(img).hexdigest()}}}); ok(f'SHOT_{n}', s, d)
# review details (no password — the owner types it in App Store Connect)
rd = {'contactFirstName': 'Shady', 'contactLastName': 'Ahmed', 'contactPhone': '+201099952333', 'contactEmail': 'shady.ahmed.abdo.1987@gmail.com',
      'demoAccountRequired': True,
      'notes': 'Dory is a free app to organize a rotating savings circle (gameya). Sign in on the start screen with "أنا صاحب جمعية" > "عندي حساب" using the demo phone number and password. The demo account already has a sample circle. The app does not move money; members record payments and the organizer confirms them. Account deletion: حسابي > حذف الحساب.'}
if os.environ.get('DEMO_USER'): rd['demoAccountName'] = os.environ['DEMO_USER']
s, d = api('GET', f'/v1/appStoreVersions/{vid}/appStoreReviewDetail')
if d.get('data'):
    rid = d['data']['id']
    s, d = api('PATCH', f'/v1/appStoreReviewDetails/{rid}', {'data': {'type': 'appStoreReviewDetails', 'id': rid, 'attributes': rd}})
else:
    s, d = api('POST', '/v1/appStoreReviewDetails', {'data': {'type': 'appStoreReviewDetails', 'attributes': rd,
           'relationships': {'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': vid}}}}})
ok('REVIEW_DETAILS', s, d)

# --- Submit for review (only when asked, and only with the right build attached)
if os.environ.get('SUBMIT') == 'yes':
    s, d = api('GET', f'/v1/appStoreVersions/{vid}/build')
    att = (d.get('data') or {}).get('attributes', {}).get('version')
    print('ATTACHED_BUILD', att)
    if not builds or att != builds[0]['attributes']['version']:
        print('SUBMIT_SKIPPED build not ready')
    else:
        s, d = api('GET', f'/v1/apps/{aid}/reviewSubmissions?filter[platform]=IOS&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES')
        open_subs = d.get('data', [])
        for x in open_subs:
            print('OPEN_SUBMISSION', x['id'], x['attributes'].get('state'))
            s3, d3 = api('GET', f"/v1/reviewSubmissions/{x['id']}/items")
            for it in d3.get('data', []): print('  ITEM', it['id'], it['attributes'].get('state'), json.dumps(it.get('relationships', {}))[:300])
        if any(x['attributes'].get('state') in ('WAITING_FOR_REVIEW', 'IN_REVIEW') for x in open_subs):
            print('SUBMIT_SKIPPED already submitted')
        else:
            sub = next((x for x in open_subs if x['attributes'].get('state') == 'READY_FOR_REVIEW'), None)
            if not sub:
                s, d = api('POST', '/v1/reviewSubmissions', {'data': {'type': 'reviewSubmissions', 'attributes': {'platform': 'IOS'},
                       'relationships': {'app': {'data': {'type': 'apps', 'id': aid}}}}}); ok('SUBMISSION_CREATE', s, d)
                sub = d.get('data')
            if sub:
                s, d = api('POST', '/v1/reviewSubmissionItems', {'data': {'type': 'reviewSubmissionItems',
                       'relationships': {'reviewSubmission': {'data': {'type': 'reviewSubmissions', 'id': sub['id']}},
                                         'appStoreVersion': {'data': {'type': 'appStoreVersions', 'id': vid}}}}}); ok('SUBMISSION_ITEM', s, d)
                if s >= 300: print('ITEM_ERRORS', json.dumps(d, ensure_ascii=False)[:4000])
                s, d = api('PATCH', f"/v1/reviewSubmissions/{sub['id']}", {'data': {'type': 'reviewSubmissions', 'id': sub['id'], 'attributes': {'submitted': True}}})
                ok('SUBMITTED', s, d)
                if s >= 300: print('SUBMIT_ERRORS', json.dumps(d, ensure_ascii=False)[:4000])
