import os, json, runpy
H = os.path.dirname(os.path.abspath(__file__))
g = runpy.run_path(os.path.join(H, 'iap_lib.py'))
api, ok, log = g['api'], g['ok'], g['log']
notes = open(os.path.join(H, 'review_notes.txt'), encoding='utf-8').read()
notes = notes.replace('1. Screen recording\nThe attached screen recording', '1. Screen recording\nThe screen recording (attached in our App Review reply)')[:3900]
s, d = api('GET', '/v1/apps?filter[bundleId]=com.shadyahmed.raseed'); aid = d['data'][0]['id']
s, d = api('GET', f'/v1/apps/{aid}/appStoreVersions?filter[platform]=IOS&limit=5')
for v in d.get('data', []):
    a = v['attributes']; log('VERSION', a['versionString'], a.get('appStoreState'))
    s2, d2 = api('GET', f"/v1/appStoreVersions/{v['id']}/appStoreReviewDetail")
    if s2 < 300 and d2.get('data'):
        ok('NOTES', *api('PATCH', f"/v1/appStoreReviewDetails/{d2['data']['id']}", {'data': {'type': 'appStoreReviewDetails', 'id': d2['data']['id'], 'attributes': {'notes': notes}}}))
