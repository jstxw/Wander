"""Offline remote-runtime tests. No Steel or OpenAI traffic."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import io
import types
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('tutor', Path(__file__).parents[1] / 'server' / 'tutor-runtime.py')
tutor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tutor)


class RuntimeTests(unittest.TestCase):
    def test_remote_inspection_rehearsal_and_navigation_knowledge(self):
        class Page:
            url = 'about:blank'
            def goto(self, url, **kwargs): self.url = url
            def evaluate(self, source):
                return {'url': self.url, 'title': 'Catalogue' if self.url.endswith('/next') else 'Home', 'text': 'Public text',
                        'elements': [{'id': 1, 'label': 'Catalogue', 'href': 'https://example.com/next'}]}
            def screenshot(self, path, **kwargs): Path(path).write_bytes(b'fixture-png')
        page = Page()
        context = types.SimpleNamespace(pages=[page], set_default_timeout=lambda value: None, route=lambda *args: None)
        browser = types.SimpleNamespace(contexts=[context], close=lambda: None)
        class Playwright:
            chromium = types.SimpleNamespace(connect_over_cdp=lambda *args, **kwargs: browser)
            def __enter__(self): return self
            def __exit__(self, *args): pass
        module = types.ModuleType('playwright.sync_api')
        module.sync_playwright = Playwright
        with tempfile.TemporaryDirectory() as temp, patch.object(tutor, 'RUNTIME_ROOT', Path(temp)), patch.object(tutor, 'ROOT', Path(temp) / 'missions'), patch.dict(tutor.sys.modules, {'playwright.sync_api': module}), patch.object(tutor, 'public_url', side_effect=lambda url: url), patch.object(tutor, 'steel', return_value={'id': 'browser', 'sessionViewerUrl': 'https://steel.dev/view'}), patch.dict(tutor.os.environ, {'STEEL_API_KEY': 'steel-test', 'OPENAI_API_KEY': 'openai-test'}):
            (Path(temp) / 'snapshot.js').write_text('function snapshotPage() {}')
            inspected = tutor.main('inspect', {'url': 'https://example.com/'}, 'mission')
            self.assertEqual(inspected['data']['workspace']['exploredPages'], 1)
            action = {'action': 'click', 'target': 1, 'value': '', 'message': 'Click Catalogue.'}
            response = {'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(action)}}], 'usage': {'prompt_tokens': 25}}
            payload = {'model': 'test', 'messages': [{'content': json.dumps({'PAGE': page.evaluate(''), 'recentActions': []})}]}
            with patch.object(tutor.urllib.request, 'urlopen', return_value=io.StringIO(json.dumps(response))) as model:
                result = tutor.main('plan', payload, 'mission')
            model.assert_called_once()
            self.assertTrue(result['data']['wanderWorkspace']['rehearsed'])
            self.assertEqual(result['data']['wanderWorkspace']['learnedRoutes'], 1)
            self.assertEqual(result['data']['wanderWorkspace']['exploredPages'], 2)
            self.assertEqual(result['data']['usage']['prompt_tokens'], 25)
            self.assertTrue((Path(temp) / 'missions/mission/guidance.json').exists())
            second = tutor.main('inspect', {'url': 'https://example.com/'}, 'mission')
            self.assertEqual(second['data']['evidence']['previouslyObservedNavigation'][0]['control'], 'Catalogue')

    def test_public_boundary_strips_query_and_refuses_private_or_sensitive_urls(self):
        address = [(2, 1, 6, '', ('93.184.216.34', 443))]
        with patch.object(tutor.socket, 'getaddrinfo', return_value=address):
            self.assertEqual(tutor.public_url('https://example.com/catalogue?q=private#token'), 'https://example.com/catalogue')
            for url in ['file:///tmp/key', 'https://user:pass@example.com', 'https://example.com/checkout', 'https://example.com:9222/']:
                with self.assertRaises(ValueError):
                    tutor.public_url(url)
        with patch.object(tutor.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 443))]):
            with self.assertRaises(ValueError):
                tutor.public_url('https://example.com/')

    def test_inspection_failure_is_honest_and_redacts_keys(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(tutor, 'ROOT', Path(temp)), patch.dict(tutor.os.environ, {'STEEL_API_KEY': 'secret-steel'}):
            with patch.object(tutor, 'shadow', side_effect=RuntimeError('secret-steel https://secret.example/token')):
                result = tutor.main('inspect', {'url': 'https://example.com'}, 'mission')
            self.assertIsNone(result['data']['evidence'])
            self.assertFalse(result['data']['workspace']['rehearsed'])
            self.assertNotIn('secret-steel', json.dumps(result))
            self.assertNotIn('secret.example', json.dumps(result))
            self.assertTrue((Path(temp) / 'mission' / 'events.jsonl').exists())

    def test_workspace_paths_cannot_escape_and_release_clears_viewer(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(tutor, 'ROOT', Path(temp)):
            with self.assertRaises(ValueError):
                tutor.main('inspect', {}, '../../elsewhere')
            directory = Path(temp) / 'mission'
            directory.mkdir()
            tutor.save(directory, 'state.json', {'sessionId': 'browser', 'viewerUrl': 'https://steel.dev/view'})
            with patch.object(tutor, 'steel', return_value={}) as api:
                result = tutor.main('release', {}, 'mission')
            api.assert_called_once_with('/sessions/browser/release', {})
            self.assertIsNone(result['data']['viewerUrl'])
            self.assertNotIn('sessionId', result['data'])


if __name__ == '__main__':
    unittest.main()
