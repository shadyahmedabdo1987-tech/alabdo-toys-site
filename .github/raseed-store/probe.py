import os, json, runpy
g = runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'iap_lib.py'))
api, log, errs = g['api'], g['log'], g['errs']
s, d = api('GET', '/v1/apps?filter[bundleId]=com.shadyahmed.raseed'); aid = d['data'][0]['id']
s, d = api('GET', f'/v1/reviewSubmissions?filter[app]={aid}&limit=10')
for r in d.get('data', []): log('SUB', r['id'], json.dumps(r['attributes']))
sid = '899cc642-33ec-43d3-85fd-22b7009c38e5'
for path in [f'/v1/reviewSubmissions/{sid}?include=items', f'/v1/reviewSubmissions/{sid}/items?include=appStoreVersion',
             f'/v1/apps/{aid}/appStoreVersions?limit=3', f'/v1/reviewSubmissions/{sid}/rejections', f'/v1/apps/{aid}/reviewRejections']:
    s, d = api('GET', path); log('GET', path, s); log(json.dumps(d, ensure_ascii=False)[:3000])
