"""End-to-end treasury creation (ADR-0007) against a local NEAR sandbox, through the real API.

Usage: python -I flow.py <mail_dir> <usdc_id> <genesis_secret> <usdc_secret>
Signs up an organization (e-mail links read from the pickup folder), prepares the treasury, funds the
address with NEAR from test.near, creates it from the API and checks the result on the node.
"""
import glob
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = 'http://localhost:5080'
RPC = 'http://127.0.0.1:3030'
MAIL, USDC, GENESIS, USDC_SECRET = sys.argv[1:5]
HERE = os.path.dirname(os.path.abspath(__file__))
SLUG = 'sandbox-' + str(int(time.time()))[-6:]
EMAIL = f'owner@{SLUG}.example'
DOTNET = os.path.join(os.environ['LOCALAPPDATA'], 'dotnet11', 'dotnet.exe')


def call(method, path, body=None, host='localhost', token=None, timeout=180):
    headers = {'Content-Type': 'application/json', 'Host': host}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(API + path, method=method, headers=headers,
                                 data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, json.loads(raw) if raw else None


def link(marker):
    for _ in range(40):
        files = sorted(glob.glob(os.path.join(MAIL, '*.json')))
        for f in reversed(files):
            m = json.load(open(f, encoding='utf-8'))
            if m['To'] == EMAIL and marker in m['Html']:
                return re.search(r'https?://[^"\s<]*' + re.escape(marker) + r'[^"\s<]*', m['Html']).group(0)
        time.sleep(1)
    raise SystemExit('no mail with ' + marker)


def tool(*args):
    out = subprocess.run([DOTNET, 'run', os.path.join(HERE, 'tool.cs'), '--', RPC, *args], capture_output=True, text=True, timeout=600)
    lines = [l for l in out.stdout.splitlines() if l and not l.startswith('USDC_SECRET')]
    if out.returncode != 0:
        raise SystemExit('tool failed: ' + out.stdout[-800:] + out.stderr[-800:])
    return lines


def rpc_view(account, method, args):
    import base64
    body = {'jsonrpc': '2.0', 'id': 1, 'method': 'query', 'params': {'request_type': 'call_function', 'finality': 'final', 'account_id': account,
            'method_name': method, 'args_base64': base64.b64encode(json.dumps(args).encode()).decode()}}
    r = json.load(urllib.request.urlopen(urllib.request.Request(RPC, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})))
    return json.loads(bytes(r['result']['result']).decode())


step = lambda msg: print('>', msg, flush=True)

step(f'sign up {SLUG} (owner wallet test.near must exist on the node)')
st, r = call('POST', '/api/signup', {'organizationName': 'Sandbox Bakery', 'slug': SLUG, 'ownerName': 'Ana', 'email': EMAIL,
                                     'nearAccountId': 'test.near', 'language': 'en', 'acceptTerms': True, 'website': ''})
assert st == 202, (st, r)
token = link('/verify?token=').split('token=')[1]
st, r = call('POST', '/api/signup/verify', {'token': token})
assert st == 200, (st, r)
setup_token = link('/setup?token=').split('token=')[1]
host = f'{SLUG}.localhost'
st, r = call('POST', '/api/setup', {'organizationName': 'Sandbox Bakery', 'ownerName': 'Ana', 'email': EMAIL,
                                             'password': 'Sandbox-Bakery-2026!', 'setupToken': setup_token}, host=host)
assert st == 201, (st, r)
jwt = r['token']

step('prepare the treasury (owner test.near, 50 / 100 USDC)')
st, setup = call('POST', '/api/treasury/setup', {'ownerAccountId': 'test.near', 'maxPerPayment': 50, 'dailyLimit': 100}, host=host, token=jwt)
assert st == 201, (st, setup)
account = setup['accountId']
print('   treasury address', account, '| code hash', setup['codeHash'][:16], '...')

step('deploy before funding is refused')
st, r = call('POST', '/api/treasury/setup/deploy', host=host, token=jwt)
assert st == 400 and 'funds' in r['errors'], (st, r)

step('owner sends 2.5 NEAR to the treasury address')
print('  ', tool('send-near', 'test.near', GENESIS, account, '2.5'))
st, ov = call('GET', '/api/treasury', host=host, token=jwt)
print('   receivedNear', ov['setup']['receivedNear'])

step('create the treasury from the API')
t0 = time.time()
st, done = call('POST', '/api/treasury/setup/deploy', host=host, token=jwt)
print(f'   HTTP {st} in {time.time() - t0:.1f}s -> {done.get("status")} {done.get("lastError") or ""}')
for s in done['steps']:
    print('  ', s)
assert done['status'] == 'Ready', done

step('verify on the node')
print('  ', tool('inspect', account, USDC))
cfg = rpc_view(account, 'get_config', {})
print('   get_config', cfg)
agent = ov['agentAccountId']
print('   agent', tool('inspect', agent, USDC))
assert cfg['owner_id'] == 'test.near' and cfg['agent_id'] == agent and cfg['max_per_payment'] == '50000000' and cfg['daily_limit'] == '100000000'

step('fund 25 USDC directly (USDC on NEAR) and read the overview')
print('  ', tool('ft-transfer', USDC, USDC_SECRET, account, '25000000'))
time.sleep(2)
st, ov = call('GET', '/api/treasury', host=host, token=jwt)
print('   balances', ov['balances'])
print('   checks', {c['id']: c['ok'] for c in ov['checks']}, '| readyForLive', ov['readyForLive'])

step('switch to Live (validated against the contract)')
st, s = call('GET', '/api/settings', host=host, token=jwt)
st, r = call('PUT', '/api/settings', {'organizationName': s['organizationName'], 'treasuryAccountId': account, 'executionMode': 'Live'}, host=host, token=jwt)
print('   PUT settings Live ->', st, r.get('executionMode') if isinstance(r, dict) else r)
print('OK: treasury created, locked and verified on a real NEAR node')
