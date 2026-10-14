"""Optional POSIX terminal check; Python/pty is only a maintainer test dependency."""
import errno
import json
import os
from pathlib import Path
import pty
import select
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

repository = Path(__file__).resolve().parents[2]
version = json.loads((repository / 'package.json').read_text())['version']
archive = Path(sys.argv[1]) if len(sys.argv) > 1 else repository / f'test-results/local-kit/reviewdesk-v{version}-local.zip'
password = 'fougere-Quartz!7926-violet'  # Disposable test credential.


def interaction(root, entries, expected):
    master, slave = pty.openpty()
    env = {key: value for key, value in os.environ.items() if key not in ('NODE_PATH', 'NODE_OPTIONS')}
    process = subprocess.Popen([shutil.which('node'), str(root / 'install.mjs')], cwd=root.parent,
                               stdin=slave, stdout=slave, stderr=slave, env=env)
    os.close(slave)
    transcript = b''
    cursor = 0
    pending = list(entries)
    deadline = time.monotonic() + 90
    try:
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    break
                if not chunk:
                    break
                transcript += chunk
            if pending:
                prompt, answer = pending[0]
                location = transcript.find(prompt.encode(), cursor)
                if location >= 0:
                    cursor = location + len(prompt.encode())
                    os.write(master, answer.encode())
                    pending.pop(0)
            if process.poll() is not None and not select.select([master], [], [], 0.1)[0]:
                break
        assert not pending, 'Interactive prompts did not complete'
        assert process.wait(timeout=10) == expected, 'Unexpected installer exit status'
        assert password.encode() not in transcript, 'Password echoed in terminal'
        assert not (root / '.reviewdesk/operation.lock').exists(), 'Installer left its lock'
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)


with tempfile.TemporaryDirectory(prefix='kit terminal espaces ') as scratch:
    with zipfile.ZipFile(archive) as package:
        assert package.testzip() is None, 'ZIP CRC validation failed'
        for name in package.namelist():
            assert name.startswith(f'reviewdesk-v{version}-local/') and '..' not in Path(name).parts
        package.extractall(scratch)
    print('Independent ZIP reader: directory, DEFLATE and CRC checks passed.')
    root = Path(scratch) / f'reviewdesk-v{version}-local'
    prompt = 'Mot de passe admin (saisie masquée, 16 caractères minimum) : '
    confirm = 'Confirmez le mot de passe : '
    interaction(root, [(prompt, 'weak\r')], 1)
    assert not (root / '.reviewdesk/config.json').exists()
    print('Weak interactive password refused without saving configuration.')
    interaction(root, [(prompt, password + '\r'), (confirm, 'different-Quartz!8397-green\r')], 1)
    assert not (root / '.reviewdesk/config.json').exists()
    print('Confirmation mismatch refused without saving configuration.')
    interaction(root, [(prompt, '\x03')], 1)
    assert not (root / '.reviewdesk/config.json').exists()
    print('Ctrl+C during password entry restores terminal and releases lock.')
    interaction(root, [(prompt, password + '\r'), (confirm, password + '\r')], 0)
    config = json.loads((root / '.reviewdesk/config.json').read_text())
    assert config['adminPassword'] == password
    print('Masked password and confirmation install successfully; credential never echoed.')
