# Raseed — remove the 27 EU countries from the app and its in-app purchases (owner is a non-trader under the DSA).
import os, sys, runpy
EU = set('AUT BEL BGR HRV CYP CZE DNK EST FIN FRA DEU GRC HUN IRL ITA LVA LTU LUX MLT NLD POL PRT ROU SVK SVN ESP SWE'.split())
g = runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'iap_lib.py'))
api, ok, log, all_pages, errs = g['api'], g['ok'], g['log'], g['all_pages'], g['errs']
s, d = api('GET', '/v1/apps?filter[bundleId]=com.shadyahmed.raseed'); aid = d['data'][0]['id']; log('APP', aid)
s, d = api('GET', f'/v1/apps/{aid}/appAvailabilityV2'); av = d.get('data'); log('AVAIL', s, bool(av))
if av:
    tas = all_pages(f"/v2/appAvailabilities/{av['id']}/territoryAvailabilities?include=territory&limit=200")
    log('TERR_AVAIL', len(tas)); n = 0
    for t in tas:
        tid = (t.get('relationships', {}).get('territory', {}).get('data') or {}).get('id')
        if tid in EU and t['attributes'].get('available'):
            s2, d2 = api('PATCH', f"/v1/territoryAvailabilities/{t['id']}", {'data': {'type': 'territoryAvailabilities', 'id': t['id'], 'attributes': {'available': False}}})
            if s2 < 300: n += 1
            else: log('  ERR', tid, errs(d2)[:200])
    log('APP_EU_REMOVED', n)
terr = [t['id'] for t in all_pages('/v1/territories?limit=200') if t['id'] not in EU]
for x in all_pages(f'/v1/apps/{aid}/inAppPurchasesV2?limit=200'):
    ok('IAP_AVAIL ' + x['attributes']['productId'], *api('POST', '/v1/inAppPurchaseAvailabilities', {'data': {'type': 'inAppPurchaseAvailabilities',
        'attributes': {'availableInNewTerritories': False}, 'relationships': {'inAppPurchase': {'data': {'type': 'inAppPurchases', 'id': x['id']}},
        'availableTerritories': {'data': [{'type': 'territories', 'id': t} for t in terr]}}}}))
    s, d = api('GET', f"/v2/inAppPurchases/{x['id']}"); log('  STATE', d.get('data', {}).get('attributes', {}).get('state'))
