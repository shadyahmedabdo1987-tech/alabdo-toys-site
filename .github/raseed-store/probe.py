import os, json, runpy
g = runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'iap_lib.py'))
api, log, errs, ok = g['api'], g['log'], g['errs'], g['ok']
s, d = api('GET', '/v1/apps?filter[bundleId]=com.shadyahmed.raseed'); aid = d['data'][0]['id']
s, d = api('GET', f'/v1/builds?filter[app]={aid}&sort=-uploadedDate&limit=3&include=buildBetaDetail,preReleaseVersion')
inc = {(x['type'], x['id']): x for x in d.get('included', [])}
for b in d.get('data', []):
    bd = inc.get(('buildBetaDetails', b['relationships']['buildBetaDetail']['data']['id']), {}).get('attributes', {})
    pv = inc.get(('preReleaseVersions', b['relationships']['preReleaseVersion']['data']['id']), {}).get('attributes', {})
    log('BUILD', b['id'], pv.get('version'), b['attributes']['version'], b['attributes'].get('processingState'), json.dumps(bd))
s, d = api('GET', f'/v1/betaGroups?filter[app]={aid}')
for gr in d.get('data', []):
    log('GROUP', gr['id'], json.dumps(gr['attributes'])[:300])
    s2, d2 = api('GET', f"/v1/betaGroups/{gr['id']}/builds?limit=5")
    log('  group builds', [x['attributes']['version'] for x in d2.get('data', [])])
    b12 = d['data'] and None
newest = None
s, d = api('GET', f'/v1/builds?filter[app]={aid}&sort=-uploadedDate&limit=1')
newest = d['data'][0]
for gr in api('GET', f'/v1/betaGroups?filter[app]={aid}')[1].get('data', []):
    ok('ADD_BUILD_TO_GROUP ' + gr['attributes']['name'], *api('POST', f"/v1/betaGroups/{gr['id']}/relationships/builds", {'data': [{'type': 'builds', 'id': newest['id']}]}))
