"""Live payment signed by the agent through the treasury contract on a local NEAR sandbox (ADR-0005/0007).

Usage: python -I pay.py <slug> <password> <usdc_id>
The organization must already have a Ready treasury in Live mode (flow.py). The quote comes from the real
NEAR Intents API (mainnet), but the USDC moves on the local node: nothing touches mainnet.
"""
import base64
import datetime
import json
import sys
import time
import urllib.error
import urllib.request

API = 'http://localhost:5080'
RPC = 'http://127.0.0.1:3030'
SLUG, PASSWORD, USDC = sys.argv[1:4]
HOST = f'{SLUG}.localhost'
REF = 'SBX-' + str(int(time.time()))[-5:]


def call(method, path, body=None, token=None, timeout=180):
    headers = {'Content-Type': 'application/json', 'Host': HOST}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(API + path, method=method, headers=headers, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, json.loads(raw) if raw else None


def view(account, method, args):
    body = {'jsonrpc': '2.0', 'id': 1, 'method': 'query', 'params': {'request_type': 'call_function', 'finality': 'final', 'account_id': account,
            'method_name': method, 'args_base64': base64.b64encode(json.dumps(args).encode()).decode()}}
    r = json.load(urllib.request.urlopen(urllib.request.Request(RPC, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})))
    return json.loads(bytes(r['result']['result']).decode())


st, login = call('POST', '/api/auth/login', {'email': f'owner@{SLUG}.example', 'password': PASSWORD})
assert st == 200, (st, login)
jwt = login['token']
st, ov = call('GET', '/api/treasury', token=jwt)
treasury = ov['treasuryAccountId']
print('> treasury', treasury, '| USDC before', view(USDC, 'ft_balance_of', {'account_id': treasury}))

print('> payee: USDC on Base, allowlisted (verified with a dry NEAR Intents quote)')
st, payee = call('POST', '/api/payees', {'name': 'Base Supplier', 'email': None, 'category': 'Supplier',
                                         'destinationAssetId': 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
                                         'recipientAddress': '0x4b8f2a91c3d7e6f05a1b9c8d7e6f5a4b3c2d1e0f', 'isAllowlisted': True, 'notes': None}, token=jwt)
assert st == 201, (st, payee)

today = datetime.date.today().isoformat()
st, bill = call('POST', '/api/bills', {'payeeId': payee['id'], 'reference': REF, 'description': 'Flour, 20 kg', 'amountUsd': 20,
                                       'dueDate': today, 'category': 'Supplier', 'extractionId': None}, token=jwt)
assert st == 201, (st, bill)

print('> agent run (real DeepSeek)')
st, run = call('POST', '/api/agent/runs', {'mode': 'Plan'}, token=jwt)
assert st == 202, (st, run)
for _ in range(90):
    st, r = call('GET', f'/api/agent/runs/{run["id"]}', token=jwt)
    if r['status'] != 'Running':
        break
    time.sleep(2)
print('   run', r['status'], '|', (r.get('summary') or '')[:160])
for d in r.get('decisions', []):
    print('   decision', d.get('billReference'), d.get('payNow'), d.get('policyOutcome'), [x['code'] for x in d.get('policyReasons') or []])

st, payments = call('GET', '/api/payments', token=jwt)
p = next(x for x in payments if x['billReference'] == REF)
print('> payment', p['status'])
if p['status'] == 'PendingApproval':
    st, r = call('POST', f'/api/payments/{p["id"]}/approve', {'note': 'Sandbox test'}, token=jwt)
    print('   approved ->', st)

for _ in range(60):
    st, p = call('GET', f'/api/payments/{p["id"]}', token=jwt)
    if p['status'] not in ('Approved', 'PendingApproval') and (p.get('onChainTxHash') or p['status'] in ('Failed', 'Rejected', 'Blocked')):
        break
    time.sleep(2)
print('> payment after execution:', p['status'], '| onChainTx', p.get('onChainTxHash'), '| error', p.get('lastError'))
deposit = (p.get('quote') or {}).get('depositAddress')
print('   1Click deposit address', deposit)
print('   USDC treasury after', view(USDC, 'ft_balance_of', {'account_id': treasury}), '| deposit address got', deposit and view(USDC, 'ft_balance_of', {'account_id': deposit}))
print('   contract get_payment', view(treasury, 'get_payment', {'payment_id': p['id']}))
print('   contract spent_today', view(treasury, 'get_config', {})['spent_today'])
