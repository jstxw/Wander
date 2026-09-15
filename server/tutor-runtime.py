"""Wander's remote tutor workspace. Runs on Steel Computer; never on the learner's tab."""
import base64
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import sys
import time
import urllib.request
import urllib.error
from urllib.parse import urlparse, urlunparse

RUNTIME_ROOT = Path('/tmp/wander-agent')
ROOT = RUNTIME_ROOT / 'missions'
BLOCKED = re.compile(r'(?:^|[/_?=&.-])(?:checkout|payment|purchase|order|logout|delete|remove|unsubscribe|confirm|submit|reserve|booking|sign.?in|login|oauth|account|token|password)(?:$|[/_?=&.-])', re.I)


def public_url(value):
    """Only public HTTP(S); never replay credentials, private hosts or query strings."""
    u = urlparse(value)
    if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password:
        raise ValueError('Public website required')
    if u.port not in (None, 80, 443) or BLOCKED.search(u.path):
        raise ValueError('Private or sensitive destination')
    addresses = socket.getaddrinfo(u.hostname, u.port or 443)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('Public website required')
    return urlunparse((u.scheme, u.netloc, u.path or '/', '', '', ''))


def steel(endpoint, body=None):
    req = urllib.request.Request('https://api.steel.dev/v1' + endpoint,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'steel-api-key': os.environ['STEEL_API_KEY'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.load(response) if response.status != 204 else {}


def save(directory, name, value):
    target = directory / name
    temporary = directory / (name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False))
    temporary.replace(target)


def event(directory, name, detail):
    with (directory / 'events.jsonl').open('a') as out:
        out.write(json.dumps({'at': time.time(), 'event': name, 'detail': detail}) + '\n')


def shadow(directory, state, url, action=None, target=None):
    state['stage'] = 'load-playwright'
    from playwright.sync_api import sync_playwright
    state['stage'] = 'validate-public-url'
    safe = public_url(url)
    if not state.get('sessionId'):
        state['stage'] = 'create-browser-session'
        session = steel('/sessions', {'timeout': 900000, 'persistProfile': False,
            'solveCaptcha': False, 'dimensions': {'width': 1366, 'height': 900}})
        state.update(sessionId=session['id'], viewerUrl=session.get('sessionViewerUrl') or session.get('debugUrl'),
                     createdAt=time.time())
        save(directory, 'state.json', state)
        event(directory, 'browser_created', 'Created an isolated public practice browser')
    snapshot = (RUNTIME_ROOT / 'snapshot.js').read_text()
    with sync_playwright() as p:
        state['stage'] = 'connect-cdp'
        browser = p.chromium.connect_over_cdp('wss://connect.steel.dev?apiKey=' + os.environ['STEEL_API_KEY'] + '&sessionId=' + state['sessionId'], timeout=20000)
        try:
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()
            context.set_default_timeout(5000)
            def guard(route):
                request = route.request
                if request.method not in ('GET', 'HEAD', 'OPTIONS'):
                    return route.abort()
                try:
                    if request.url.startswith(('data:', 'blob:')):
                        return route.continue_()
                    public_url(request.url)
                except Exception:
                    return route.abort()
                return route.continue_()
            context.route('**/*', guard)
            if not action:
                state['stage'] = 'navigate-public-page'
                # Fresh navigation keeps a public rehearsal anchored to the learner's current page.
                page.goto(safe, wait_until='domcontentloaded', timeout=20000)
            state['stage'] = 'extract-observation'
            before = page.evaluate('(' + snapshot + ')')
            rehearsed = False
            if action and action.get('action') == 'scroll':
                page.mouse.wheel(0, -600 if action.get('value') == 'up' else 600)
                rehearsed = True
            elif action and action.get('action') == 'click' and target and not target.get('sensitive'):
                # Rehearse only an unambiguous same-origin public link, not arbitrary buttons/forms.
                matches = [e for e in before['elements'] if e.get('label') == target.get('label') and e.get('href')]
                if len(matches) == 1:
                    href = public_url(matches[0]['href'])
                    if urlparse(href).netloc == urlparse(safe).netloc:
                        page.goto(href, wait_until='domcontentloaded', timeout=15000)
                        rehearsed = True
            after = page.evaluate('(' + snapshot + ')')
            name = 'evidence-%s.png' % state.get('decisions', 0)
            try:
                page.screenshot(path=str(directory / name), timeout=5000)
                state['screenshot'] = name
            except Exception:
                pass
            state['shadowTitle'] = after['title']
            state['shadowUrl'] = after['url']
            state['rehearsed'] = rehearsed
            state['phase'] = 'rehearsed' if rehearsed else 'observed'
            # Accumulate observed navigation knowledge, not a scripted lesson plan.
            knowledge_file = directory / 'site-map.json'
            knowledge = json.loads(knowledge_file.read_text()) if knowledge_file.exists() else {'pages': {}, 'transitions': []}
            for observed in (before, after):
                knowledge['pages'][observed['url']] = {'title': observed['title'],
                    'controls': [e['label'] for e in observed['elements'][:25]], 'at': time.time()}
            if rehearsed and before['url'] != after['url']:
                transition = {'from': before['url'], 'control': (target or {}).get('label', ''), 'to': after['url'], 'title': after['title']}
                if transition not in knowledge['transitions']:
                    knowledge['transitions'].append(transition)
            knowledge['pages'] = dict(list(knowledge['pages'].items())[-40:])
            knowledge['transitions'] = knowledge['transitions'][-60:]
            save(directory, 'site-map.json', knowledge)
            state['exploredPages'] = len(knowledge['pages'])
            state['learnedRoutes'] = len(knowledge['transitions'])
            save(directory, 'observation.json', after)
            event(directory, 'rehearsal' if action else 'observation',
                  'Public navigation rehearsed' if rehearsed else 'Public page inspected; learner remains in control')
            return after
        finally:
            # Disconnect the CDP client. Steel retains the session until explicit release/timeout.
            browser.close()


def main(operation, payload, run_id):
    if not re.fullmatch(r'[a-zA-Z0-9-]{1,80}', run_id):
        raise ValueError('Invalid mission')
    directory = ROOT / run_id
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    state_file = directory / 'state.json'
    state = json.loads(state_file.read_text()) if state_file.exists() else {'decisions': 0}
    if operation == 'evidence':
        name = state.get('screenshot', '')
        if not re.fullmatch(r'evidence-\d+\.png', name) or not (directory / name).exists():
            return {'status': 404}
        raw = (directory / name).read_bytes()
        if len(raw) > 2_000_000:
            return {'status': 413}
        return {'status': 200, 'data': {'image': 'data:image/png;base64,' + base64.b64encode(raw).decode()}}
    if operation == 'release':
        if state.get('sessionId'):
            steel('/sessions/' + state['sessionId'] + '/release', {})
            state.pop('sessionId', None)
        state.update(phase='ended', viewerUrl=None)
        save(directory, 'state.json', state)
        return {'status': 200, 'data': state}
    if operation == 'inspect':
        try:
            observation = shadow(directory, state, payload['url'])
            evidence = {'title': observation['title'], 'url': observation['url'],
                        'text': observation['text'][:2200], 'elements': observation['elements'][:15]}
            knowledge = json.loads((directory / 'site-map.json').read_text())
            evidence['previouslyObservedNavigation'] = knowledge['transitions'][-5:]
            state['limitation'] = None
        except Exception as error:
            evidence = None
            detail = str(error)
            if isinstance(error, urllib.error.HTTPError):
                detail += ' ' + error.read(1500).decode('utf-8', errors='replace')
            for secret in (os.environ.get('STEEL_API_KEY'), os.environ.get('OPENAI_API_KEY')):
                if secret:
                    detail = detail.replace(secret, '[redacted]')
            detail = re.sub(r'(?:https?|wss?)://\S+', '[URL]', detail)
            state['diagnostic'] = (state.get('stage', 'inspection') + ': ' + type(error).__name__ + ': ' + detail)[:1000]
            state.update(phase='local-observation', rehearsed=False,
                limitation='The separate browser cannot inspect this page. Guidance uses your current tab; no rehearsal is claimed.')
            event(directory, 'boundary', state['limitation'])
        save(directory, 'state.json', state)
        state['artifacts'] = sorted(p.name for p in directory.iterdir() if p.is_file() and not p.name.endswith('.tmp'))
        return {'status': 200, 'data': {'evidence': evidence, 'workspace': state}}
    if operation != 'plan':
        raise ValueError('Unknown operation')
    # The request is already budget-reserved by the local server. Never retry a paid call.
    req = urllib.request.Request('https://api.openai.com/v1/chat/completions', data=json.dumps(payload).encode(),
        headers={'Authorization': 'Bearer ' + os.environ['OPENAI_API_KEY'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as response:
        data = json.load(response)
    state['decisions'] += 1
    try:
        action = json.loads(data['choices'][0]['message']['content'])
        user = json.loads(payload['messages'][-1]['content'])
        page = user['PAGE']
        target = next((e for e in page['elements'] if e['id'] == action.get('target')), None)
        state['rehearsed'] = False
        if state.get('phase') != 'local-observation' and action.get('action') in ('click', 'scroll'):
            try:
                shadow(directory, state, page['url'], action, target)
            except Exception:
                state['phase'] = 'observed'
        save(directory, 'guidance.json', action)
        event(directory, 'guidance', {'action': action.get('action'), 'targetLabel': (target or {}).get('label'),
                                    'rehearsed': state['rehearsed']})
        # Store progress and evidence, never input field values or the complete model request.
        save(directory, 'progress.json', {'decisions': state['decisions'], 'history': user.get('recentActions', [])})
    except Exception:
        event(directory, 'guidance_error', 'Could not rehearse this decision; response still validated by coordinator')
    save(directory, 'state.json', state)
    state['artifacts'] = sorted(p.name for p in directory.iterdir() if p.is_file() and not p.name.endswith('.tmp'))
    data['wanderWorkspace'] = state
    return {'status': 200, 'data': data}


if __name__ == '__main__':
    try:
        result = main(sys.argv[1], json.loads(base64.b64decode(sys.argv[2])), sys.argv[3])
    except urllib.error.HTTPError as error:
        result = {'status': error.code}
    except Exception:
        result = {'status': 502}
    print(json.dumps(result))
