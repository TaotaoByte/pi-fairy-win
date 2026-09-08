#!/usr/bin/env python3
"""Private native/exec/PTY checks. No WindowServer, audio or user cache/socket."""
import json, os, pathlib, pty, select, signal, socket, subprocess, tempfile, time, threading

PACKAGE = pathlib.Path(__file__).resolve().parents[3]
NATIVE = PACKAGE / 'modules/animation/native'
CLIENT = PACKAGE / 'modules/animation/src/desktop/client.ts'

def run(*args, timeout=30):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout)

def wait(predicate, timeout=3):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate(): return
        time.sleep(.01)
    raise AssertionError('bounded condition timeout')

with tempfile.TemporaryDirectory(prefix='fairy-startup-entry-') as temp:
    root = pathlib.Path(temp); home = root/'home'; agent = home/'.pi/agent'; agent.mkdir(parents=True)
    ipc = root/'ipc'; ipc.mkdir(mode=0o700)
    cwd = root/'cwd'; cwd.mkdir(); (cwd/'.pi').mkdir(); (cwd/'.pi/npm').mkdir()
    (cwd/'.pi/settings.json').write_text('{"packages":[]}')
    (agent/'settings.json').write_text(json.dumps({'packages':[str(PACKAGE)],'theme':'dark','lastChangelogVersion':'old'}))
    source = (NATIVE/'Startup.swift').read_text()
    # Replace only the two ownership roots, no guard/protocol/exec code.
    source = source.replace('let home = FileManager.default.homeDirectoryForCurrentUser.path', 'let home = '+json.dumps(str(home)))
    source = source.replace('let directory = "/tmp/pi-fairy-\\(getuid())"', 'let directory = '+json.dumps(str(ipc)))
    (root/'Startup.swift').write_text(source)
    run('/usr/bin/swiftc','-O',str(root/'Startup.swift'),'-o',str(root/'Startup'))
    run('/usr/bin/swiftc','-O',str(NATIVE/'Fairy.swift'),'-o',str(root/'Fairy'))
    node = run('/usr/bin/which','node').stdout.strip()
    stub = root/'pi'
    (root/'package.json').write_text(json.dumps({'name':'@earendil-works/pi-coding-agent','bin':{'pi':'pi'}}))
    stub.write_text('#!'+node+' --experimental-strip-types\n'+f'''
import {{ Socket }} from 'node:net';
import {{ consumeStartupLease, claimStartupLease, DesktopClient }} from {json.dumps(CLIENT.as_uri())};
const startup = consumeStartupLease();
console.log('PI-FIRST-BYTE '+JSON.stringify({{pid:process.pid,tty:[process.stdin.isTTY,process.stdout.isTTY,process.stderr.isTTY],startup:!!startup,envRemoved:!process.env.FAIRY_STARTUP_FD&&!process.env.FAIRY_STARTUP_TOKEN,args:process.argv.slice(2)}}));
if (startup) {{
 if (process.env.CLIENT_ADOPT) {{
  const client = new DesktopClient(message=>{{throw new Error(message)}},{{directory:async()=>{json.dumps(str(ipc))},launch:async()=>{{throw new Error('duplicate launch')}}}},'/unused-sounds',startup);
  client.start();
  for(let i=0;i<200&&!client.socket;i++) await new Promise(resolve=>setTimeout(resolve,5));
  if(!client.socket)throw new Error('missing adopted client socket');
  console.log('CLAIMED');client.dispose();
 }} else {{
  const socket = new Socket({{fd:startup.fd,readable:true,writable:true}});
  await claimStartupLease(socket,startup.token); console.log('CLAIMED');socket.destroy();
 }}
}}
if (process.env.STUB_WAIT) {{
 let interrupts=0; process.on('SIGINT',()=>{{console.log('INTERRUPTS '+(++interrupts));process.exit(130)}});
 setInterval(()=>{{}},1000);console.log('SIGNAL-READY');
}} else process.exit(23);
'''); stub.chmod(0o700)
    env = dict(os.environ); env.pop('PI_SUBAGENT_CHILD',None); env.pop('PI_CODING_AGENT_DIR',None);env.pop('NODE_OPTIONS',None);env.pop('PI_PACKAGE_DIR',None)
    for k in ['FAIRY_STARTUP_FD','FAIRY_STARTUP_TOKEN']: env.pop(k,None)
    children=[]
    def launch_helper():
        p=subprocess.Popen([str(root/'Fairy'),str(ipc),str(PACKAGE/'modules/animation/assets'),'--headless','--intro-saved'], env={**env,'FAIRY_SETTINGS_DIRECTORY':str(root/'settings')},stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        children.append(p); wait(lambda:(ipc/'sock').exists()); return p
    def connect(hello):
        s=socket.socket(socket.AF_UNIX);s.settimeout(2);s.connect(str(ipc/'sock'));s.sendall(hello.encode());return s
    def invoke(expect, extra_env=None, control=None, helper_path=None, expected_status=23, argv0=None, control_wait_path=None, external=None):
        pid,master=pty.fork()
        if pid==0:
            os.chdir(cwd);os.execve(str(root/'Startup'),[str(argv0 or root/'Startup'),str(external or stub),str(PACKAGE),str(helper_path or root/'Fairy')],{**env,**(extra_env or {})})
        output=b'';start=time.monotonic();status=None
        try:
            if control:
                if control_wait_path:wait(control_wait_path.exists)
                else:time.sleep(.1)
                os.write(master,control)
            while time.monotonic()-start<4:
                if select.select([master],[],[],.05)[0]:
                    try:output+=os.read(master,8192)
                    except OSError:pass
                done,status=os.waitpid(pid,os.WNOHANG)
                if done:break
            else:
                state=subprocess.run(['/bin/ps','-o','pid,ppid,pgid,tpgid,state,command','-p',str(pid)],capture_output=True,text=True,timeout=2)
                os.kill(pid,signal.SIGKILL);os.waitpid(pid,0);raise AssertionError((output,state.stdout,state.stderr))
            if control:assert os.WIFSIGNALED(status) and os.WTERMSIG(status)==signal.SIGINT,(status,output)
            elif expected_status != 23:
                assert os.waitstatus_to_exitcode(status)==expected_status and b'PI-FIRST-BYTE' not in output,(status,output)
            else:
                assert os.waitstatus_to_exitcode(status)==23,(status,output)
                line=next(x for x in output.decode().splitlines() if x.startswith('PI-FIRST-BYTE '));data=json.loads(line[14:])
                assert data['pid']==pid and data['tty']==[True,True,True] and data['envRemoved'],data
                assert data['startup']==expect,(data,output)
                if expect:assert b'CLAIMED' in output,output
            return time.monotonic()-start,output.decode()
        finally:os.close(master)
    try:
        helper=launch_helper()
        token='11111111-1111-4111-8111-111111111111'
        a=connect('prelude FAIRY2 '+token+'\n');assert a.recv(128)==('FAIRY2 ready '+token+'\n').encode()
        # Native existing-owner handoff and two concurrent starters each keep their own peer.
        results=[]
        for _ in range(2):results.append(invoke(True)[0])
        invoke(True,{'CLIENT_ADOPT':'1'})
        a.sendall(('claim '+token+'\n').encode());assert a.recv(128)==('FAIRY2 claimed '+token+'\n').encode()
        a.sendall(b'theme light\n')
        print('PASS native ready -> exec same PID/TTY -> production Node fd claim; launch seconds',results)
        # Neutral project/cache and ordinary settings edits do not disable early entry.
        (agent/'settings.json').write_text(json.dumps({'packages':[str(PACKAGE)],'theme':'light','defaultModel':'changed','lastChangelogVersion':'future'}));invoke(True)
        for settings in [{},{'packages':[]},{'packages':[{'source':str(PACKAGE),'extensions':[]}]},{'packages':[str(PACKAGE)],'extensions':['-anything']}]:
            (agent/'settings.json').write_text(json.dumps(settings));invoke(False)
        (agent/'settings.json').write_text(json.dumps({'packages':[str(PACKAGE)]}))
        (cwd/'.pi/settings.json').write_text('{"extensions":["anything"]}');invoke(False)
        (cwd/'.pi/settings.json').write_text('{"packages":[]}');(cwd/'.pi/extensions').mkdir();invoke(False);(cwd/'.pi/extensions').rmdir()
        invoke(False,{'PI_SUBAGENT_CHILD':'1'});invoke(False,{'PI_CODING_AGENT_DIR':str(root/'unknown')})
        invoke(False,helper_path=root/'missing-cache')
        (root/'package.json').write_text('{"name":"unknown-host"}');invoke(False)
        (root/'package.json').write_text(json.dumps({'name':'@earendil-works/pi-coding-agent','bin':{'pi':'pi'}}))
        stub.chmod(0o600)
        try:invoke(False,expected_status=126)
        finally:stub.chmod(0o700)
        print('PASS recognized-neutral project and model/theme/changelog changes; disabled/filter/project/subagent/agent-dir/unknown-host/cache-miss fallbacks and exec failure')
        # Independent pending peers; invalid claim drops only its own provisional lease.
        b=connect('prelude FAIRY2 22222222-2222-4222-8222-222222222222\n');assert b.recv(128).startswith(b'FAIRY2 ready ')
        b.sendall(b'claim wrong\n');assert b.recv(128)==b'';b.close()
        a.sendall(b'theme dark\n');assert helper.poll() is None
        c=connect('prelude FAIRY2 33333333-3333-4333-8333-333333333333\n');assert c.recv(128).startswith(b'FAIRY2 ready ')
        c.settimeout(16);start=time.monotonic();assert c.recv(128)==b'';assert 14<time.monotonic()-start<16;c.close()
        assert helper.poll() is None;print('PASS independent tokens, rejected claim, unchanged claimed lease, 15s unclaimed expiry')
        # The original shell template delegates all arguments and dynamically resolves PATH.
        shell = PACKAGE/'modules/animation/scripts/startup.zsh'
        assert run('/bin/zsh','-f','-c',f'source "{shell}"; print -r -- "$FAIRY_STARTUP_PACKAGE"').stdout.strip()==str(PACKAGE)
        upgraded=root/'upgraded-host';upgraded.mkdir();(upgraded/'pi').write_text(stub.read_text());(upgraded/'pi').chmod(0o700)
        (upgraded/'package.json').write_text(json.dumps({'name':'@earendil-works/pi-coding-agent','version':'9999.0.0','bin':{'pi':'pi'}}))
        invoke(True,external=upgraded/'pi')
        other = root/'next'; other.mkdir(); (other/'pi').write_text('#!/bin/sh\nprintf "UPGRADED:%s\\n" "$*"\nexit 17\n');(other/'pi').chmod(0o700)
        shell_env={**env,'PATH':str(root)+':'+env['PATH']}
        for args in ['--mode rpc', '-p hello', '--help', '--version', 'update', 'config', '-ne', '--fairy-anim-mode terminal', '--fairy-anim-mode=desktop', '--fairy-anim-mode pixel', '--fairy-anim-mode unknown', '"arg space" "*"']:
            r=subprocess.run(['/bin/zsh','-f','-c',f'source "{shell}"; pi {args}'],cwd=cwd,env=shell_env,capture_output=True,text=True,timeout=3)
            assert r.returncode==23 and '"startup":false' in r.stdout,(args,r)
        r=subprocess.run(['/bin/zsh','-f','-c',f'source "{shell}"; PATH="{other}:$PATH"; pi --version'],cwd=cwd,env=shell_env,capture_output=True,text=True,timeout=3)
        assert r.returncode==17 and 'UPGRADED:--version' in r.stdout
        print('PASS actual zsh argument/stdio/status delegation and changed PATH upgrade; no original executable replacement')
        # Private resolver replaces only cache discovery; original function/command execution stays real.
        template=shell.read_text(); needle='command node --experimental-strip-types "$FAIRY_STARTUP_PACKAGE/modules/animation/scripts/startup-cache.ts" 2>/dev/null'
        assert needle in template
        template=template.replace(needle, 'printf "%s\\n" "$TEST_STARTUP" "$TEST_HELPER"')
        (root/'startup.zsh').write_text(template)
        pid,master=pty.fork()
        if pid==0:
            os.chdir(cwd);os.execve('/bin/zsh',['zsh','-f'],{**shell_env,'TEST_STARTUP':str(root/'Startup'),'TEST_HELPER':str(root/'Fairy'),'STUB_WAIT':'1','PS1':'TEST-PROMPT> '})
        output=b''
        def read_until(text):
            global output
            end=time.monotonic()+4
            while text not in output and time.monotonic()<end:
                if select.select([master],[],[],.05)[0]:
                    try:output+=os.read(master,8192)
                    except OSError:break
            assert text in output,output
        waiting_pid=None
        try:
            read_until(b'TEST-PROMPT> ');output=b''
            command=f'source "{root}/startup.zsh"; FAIRY_STARTUP_PACKAGE="{PACKAGE}"; pi; print RESULT:$?\n'
            os.write(master,command.encode());read_until(b'SIGNAL-READY')
            waiting_pid=json.loads(next(line[14:] for line in output.decode().splitlines() if line.startswith('PI-FIRST-BYTE ')))['pid'];output=b''
            os.write(master,b'\x1a');read_until(b'suspended');read_until(b'TEST-PROMPT> ');output=b''
            os.write(master,b'fg\n');read_until(b'continued');output=b''
            os.write(master,b'\x03');read_until(b'INTERRUPTS 1')
            assert b'INTERRUPTS 2' not in output
            read_until(b'TEST-PROMPT> ')
            # The shell is only a private harness; teardown below owns its PID.
            # Do not infer ZLE input readiness from prompt bytes alone.
        finally:
            if waiting_pid:
                try:os.kill(waiting_pid,signal.SIGKILL)
                except ProcessLookupError:pass
            try:os.kill(pid,signal.SIGKILL);os.waitpid(pid,0)
            except ProcessLookupError:pass
            os.close(master)
        print('PASS actual zsh foreground entry, Ctrl-Z / fg job control and single Ctrl-C delivery after exec')
        a.close();helper.terminate();helper.communicate(timeout=2)
        # Unsupported old owner and silent owner do not activate/replay or block Pi indefinitely.
        for response in [b'',b'FAIRY2 123\n',None]:
            server=socket.socket(socket.AF_UNIX);server.bind(str(ipc/'sock'));server.listen(2)
            def peer():
                conn,_=server.accept();hello=conn.recv(128);assert hello.startswith(b'prelude FAIRY2 ')
                if response is not None:
                    if response:conn.sendall(response)
                    conn.close()
                else:time.sleep(1.8);conn.close()
            thread=threading.Thread(target=peer);thread.start()
            elapsed,_=invoke(False);assert elapsed<2.5
            thread.join(3);server.close();(ipc/'sock').unlink()
        # Interrupt while waiting for ready: no Pi child launched or duplicate signal forwarding.
        server=socket.socket(socket.AF_UNIX);server.bind(str(ipc/'sock'));server.listen(1)
        def stalled():
            conn,_=server.accept();conn.recv(128);time.sleep(.4);conn.close()
        thread=threading.Thread(target=stalled);thread.start();_,out=invoke(False,control=b'\x03');assert 'PI-FIRST-BYTE' not in out
        thread.join(2);server.close();(ipc/'sock').unlink()
        print('PASS unsupported/closed/silent owner fallback bounded; Ctrl-C during prelude launches no Pi')
        bad=root/'bad-helper';bad.write_text('not an executable format\n');bad.chmod(0o700)
        elapsed,_=invoke(False,helper_path=bad);assert elapsed<2.5
        trampoline=root/'stalled-trampoline';marker=root/'trampoline-pid'
        trampoline.write_text('#!/bin/sh\nprintf "%s" "$$" > "'+str(marker)+'"\nexec /bin/sleep 30\n');trampoline.chmod(0o700)
        elapsed,_=invoke(False,argv0=trampoline);assert elapsed<2.5
        abandoned=int(marker.read_text())
        try:os.kill(abandoned,0);raise AssertionError('timed-out trampoline not reaped')
        except ProcessLookupError:pass
        marker.unlink();_,out=invoke(False,argv0=trampoline,control=b'\x03',control_wait_path=marker)
        assert 'PI-FIRST-BYTE' not in out
        abandoned=int(marker.read_text())
        def trampoline_gone():
            try:os.kill(abandoned,0);return False
            except ProcessLookupError:return True
        wait(trampoline_gone,3)
        print('PASS bounded owned-trampoline timeout/reaping and foreground Ctrl-C cancellation; no Pi proxy')
        shim=root/'headless-helper'
        shim.write_text('#!/bin/sh\nprintf "%s" "$$" > "'+str(root/'spawned-pid')+'"\nprintf "%s\\n" "$@" > "'+str(root/'spawned-args')+'"\nexport FAIRY_SETTINGS_DIRECTORY="'+str(root/'spawned-settings')+'"\nexec "'+str(root/'Fairy')+'" "$1" "'+str(PACKAGE/'modules/animation/assets')+'" --headless --intro-saved\n');shim.chmod(0o700)
        (root/'spawned-settings').mkdir()
        (root/'spawned-settings/settings.json').write_text('{"version":2,"size":"standard","welcome":"simple"}')
        invoke(True,helper_path=shim)
        assert '--intro-saved' in (root/'spawned-args').read_text().splitlines()
        assert '--rest-reminder' in (root/'spawned-args').read_text().splitlines()
        assert str(PACKAGE/'modules/voice/sounds') in (root/'spawned-args').read_text().splitlines()
        assert '--intro-full' not in (root/'spawned-args').read_text().splitlines()
        owned=int((root/'spawned-pid').read_text())
        def reaped():
            try:os.kill(owned,0);return False
            except ProcessLookupError:return True
        try:wait(reaped,5)
        finally:
            if not reaped():os.kill(owned,signal.SIGTERM)
        print('PASS failed helper spawn falls through; detached private headless launch ready/exec/claim and final lease cleanup')
        # The next native-launched lifetime reads full from the same saved-mode seam.
        (root/'spawned-settings/settings.json').write_text('{"version":2,"size":"standard","welcome":"full"}')
        # The real exec target is Node: release the adopted lease, but keep Pi alive.
        pid,master=pty.fork();owned=None
        if pid==0:
            os.chdir(cwd);os.execve(str(root/'Startup'),[str(root/'Startup'),str(stub),str(PACKAGE),str(shim)],{**env,'STUB_WAIT':'1','CLIENT_ADOPT':'1'})
        try:
            output=b'';end=time.monotonic()+4
            while b'SIGNAL-READY' not in output and time.monotonic()<end:
                if select.select([master],[],[],.05)[0]:output+=os.read(master,8192)
            assert b'SIGNAL-READY' in output,output
            owned=int((root/'spawned-pid').read_text());time.sleep(4)
            os.kill(pid,0)
            state=subprocess.run(['/bin/ps','-o','pid,ppid,state,command','-p',str(owned)],capture_output=True,text=True,timeout=2)
            print('alive-Node helper retirement snapshot:',state.stdout.strip(),flush=True)
            assert state.returncode!=0, 'retired helper must be reaped while exec target Node remains alive'
        finally:
            os.kill(pid,signal.SIGTERM);os.waitpid(pid,0);os.close(master)
            if owned:
                try:os.kill(owned,signal.SIGTERM)
                except ProcessLookupError:pass
        print('PASS detached helper retirement is reaped while claimed Node Pi remains alive')
        r=subprocess.run([str(root/'Startup'),str(stub),str(PACKAGE),str(root/'Fairy')],cwd=cwd,env=env,capture_output=True,text=True,timeout=3)
        assert r.returncode==23 and '"startup":false' in r.stdout;print('PASS nonTTY stdio/status fallback')
    finally:
        for child in children:
            if child.poll() is None:child.terminate()
            try:child.communicate(timeout=2)
            except subprocess.TimeoutExpired:child.kill();child.communicate();raise
print('PASS startup-entry private native suite')
