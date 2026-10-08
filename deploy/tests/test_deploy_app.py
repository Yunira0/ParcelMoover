"""Exercise the real deployment shell script with isolated host commands."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'deploy-app.sh'
FAKE = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root=Path(os.environ['FAKE_ROOT']); args=sys.argv[1:]; cmd=Path(sys.argv[0]).name
with (root/'calls').open('a') as f: f.write(json.dumps([cmd]+args)+'\\n')
fail=os.environ.get('FAIL','')
if cmd=='docker':
 if args[0]=='inspect':
  print('deploy_db-data' if args[1]=='deploy-db-1' else 'ghcr.io/example/app:old')
 elif 'pull' in args and fail=='pull': sys.exit(1)
 elif 'up' in args:
  if fail=='up': sys.exit(1)
  (root/'candidate').write_text(args[-1])
elif cmd=='curl':
 url=args[-1]
 if (':3000/' if os.environ.get('GREEN') else ':3001/') in url:
  count=int((root/'probes').read_text())+1; (root/'probes').write_text(str(count))
  if fail=='ready' or count<3: sys.exit(22)
 if url.startswith('http://127.0.0.1/') and fail=='proxy': sys.exit(22)
 if ':3001/' in url and os.environ.get('GREEN') and fail=='active': sys.exit(22)
elif cmd in ('nginx','systemctl'):
 if fail==cmd and not (root/'failed-once').exists():
  (root/'failed-once').touch(); sys.exit(1)
elif cmd=='flock' and fail=='lock': sys.exit(1)
'''

class DeploymentTest(unittest.TestCase):
    def run_deploy(self, fail='', green=False, mode='deploy'):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        root=Path(temp.name); app=root/'app'; conf=root/'conf'; binpath=root/'bin'
        (app/'deploy/nginx').mkdir(parents=True); conf.mkdir(); binpath.mkdir()
        (app/'deploy/nginx/nginx.conf').write_text('new main')
        (app/'deploy/nginx/parcelmoover.conf').write_text('new site')
        (conf/'main').write_text('old main'); (conf/'site').write_text('old site')
        if green: (conf/'upstream').write_text('upstream parcelmoover_app { server 127.0.0.1:3001; }\n')
        if mode=='rollback': (app/'deploy/.previous-app-port').write_text('3000\n')
        (root/'probes').write_text('0')
        for name in ['docker','curl','nginx','systemctl','flock','sleep']:
            p=binpath/name; p.write_text(FAKE); p.chmod(0o755)
        env={**os.environ, 'PATH':str(binpath)+os.pathsep+os.environ['PATH'],
             'FAKE_ROOT':str(root), 'FAIL':fail, 'GREEN':'1' if green else '',
             'APP_DIR':str(app), 'APP_IMAGE':'ghcr.io/example/app:new',
             'NGINX_MAIN':str(conf/'main'), 'NGINX_SITE':str(conf/'site'),
             'NGINX_UPSTREAM':str(conf/'upstream'), 'DEPLOY_LOCK':str(root/'lock'),
             'HEALTH_ATTEMPTS':'4','HEALTH_INTERVAL':'0'}
        result=subprocess.run(['bash',str(SCRIPT),mode],env=env,capture_output=True,text=True,timeout=15)
        calls=[json.loads(line) for line in (root/'calls').read_text().splitlines()]
        return root, result, calls

    def test_waits_before_switch_and_never_recreates_active_or_dependencies(self):
        root, result, calls=self.run_deploy()
        self.assertEqual(result.returncode,0,result.stderr)
        up=[c for c in calls if c[0]=='docker' and 'up' in c]
        self.assertEqual(len(up),1); self.assertEqual(up[0][-4:],['up','-d','--no-deps','app-green'])
        reload_index=calls.index(['systemctl','reload','nginx'])
        self.assertGreater(len([c for c in calls[:reload_index] if c[0]=='curl' and ':3001/' in c[-1]]),3)
        self.assertIn(':3001;', (root/'conf/upstream').read_text())
        self.assertEqual((root/'app/deploy/.previous-app-port').read_text(),'3000\n')
        self.assertFalse(any('stop' in c or 'down' in c for c in calls))

    def test_next_release_alternates_to_blue(self):
        root,result,calls=self.run_deploy(green=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn(':3000;', (root/'conf/upstream').read_text())
        self.assertEqual([c[-1] for c in calls if c[0]=='docker' and 'up' in c],['app'])

    def test_failures_preserve_original_configuration_and_active_container(self):
        for failure in ['pull','up','ready','nginx','systemctl','proxy','lock']:
            with self.subTest(failure=failure):
                root,result,calls=self.run_deploy(fail=failure)
                self.assertNotEqual(result.returncode,0)
                self.assertEqual((root/'conf/main').read_text(),'old main')
                self.assertEqual((root/'conf/site').read_text(),'old site')
                self.assertFalse((root/'conf/upstream').exists())
                self.assertFalse((root/'app/deploy/.previous-app-port').exists())
                self.assertFalse(any('stop' in c or 'down' in c for c in calls))
                self.assertFalse(any(c[0]=='docker' and 'up' in c and c[-1]=='app' for c in calls))

    def test_failed_cutover_restores_existing_green_route(self):
        root,result,calls=self.run_deploy(fail='proxy',green=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn(':3001;', (root/'conf/upstream').read_text())

    def test_rollback_switches_to_retained_container_without_restarting(self):
        root,result,calls=self.run_deploy(fail='active',green=True,mode='rollback')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn(':3000;', (root/'conf/upstream').read_text())
        self.assertFalse(any(c[0]=='docker' and ('up' in c or 'pull' in c) for c in calls))
        self.assertEqual((root/'app/deploy/.previous-app-port').read_text(),'3001\n')

    def test_active_container_names_the_live_slot(self):
        with tempfile.TemporaryDirectory() as temp:
            upstream=Path(temp)/'upstream'
            env={**os.environ,'NGINX_UPSTREAM':str(upstream)}
            run=lambda: subprocess.run(['bash',str(SCRIPT),'active-container'],env=env,capture_output=True,text=True,timeout=15)
            self.assertEqual(run().stdout.strip(),'deploy-app-1')
            upstream.write_text('upstream parcelmoover_app { server 127.0.0.1:3001; }\n')
            self.assertEqual(run().stdout.strip(),'deploy-app-green-1')

if __name__=='__main__': unittest.main()
