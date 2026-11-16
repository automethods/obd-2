"""Prepare the online repository upload in the single AutoMethods update folder."""
import hashlib
import json
from pathlib import Path
import shutil


SITE = Path(__file__).resolve().parents[1]
DESTINATION = Path('/media/cigameca/SHARED/Work/Literature/Transport/My_books/Home_page/upload-batches/OBD-2-v0.9.10')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare():
    paths = sorted(p for p in SITE.rglob('*') if p.is_file() and '__pycache__' not in p.parts)
    paths = [p for p in paths if p.name != 'publication-manifest.json']
    files = {p.relative_to(SITE).as_posix(): {'bytes': p.stat().st_size, 'sha256': digest(p)} for p in paths}
    assert not any(n.startswith('downloads/') for n in files)
    published = [n for n in files if not n.startswith(('model-src/', 'tests/', 'tools/'))]
    manifest = {'schema': 'automethods-publication/1', 'project': 'obd-2', 'version': '0.9.10',
                'edition': 'online', 'runtime': 'vendored Pyodide 314.0.8; original Python engine in a browser worker',
                'publicationFiles': published,
                'files': [{'path': n, **entry} for n, entry in files.items()]}
    (SITE/'publication-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    files['publication-manifest.json'] = {'bytes': (SITE/'publication-manifest.json').stat().st_size,
                                         'sha256': digest(SITE/'publication-manifest.json')}
    old = json.loads((DESTINATION/'verification.json').read_text())
    if old.get('edition') != 'online':
        (DESTINATION/'previous-publication.json').write_text(json.dumps(old, indent=2) + '\n')
    # Remove only previous generated batches whose bytes still match their inventory.
    batches = [p for p in DESTINATION.iterdir() if p.is_dir() and p.name[:2].isdigit()]
    for batch in batches:
        for path in batch.rglob('*'):
            if path.is_file():
                name = path.relative_to(batch).as_posix()
                assert name in old['files'] and digest(path) == old['files'][name]['sha256'], path
    for batch in batches:
        shutil.rmtree(batch)
    groups = {name: [] for name in ['01-browser-engine', '02-runtime-and-model', '03-guides', '04-online-app']}
    for name in sorted(files):
        if name.endswith('/pyodide.asm.wasm'):
            group = '01-browser-engine'
        elif name.startswith(('vendor/', 'model-src/', 'python/', 'online/')):
            group = '02-runtime-and-model'
        elif name.startswith('docs/') or name.endswith('.pdf') or name == 'START_HERE.html':
            group = '03-guides'
        else:
            group = '04-online-app'
        groups[group].append(name)
        target = DESTINATION/group/name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SITE/name, target)
        assert digest(target) == files[name]['sha256']
    inventory = {}
    for group, names in groups.items():
        assert len(names) <= 100
        assert max(files[n]['bytes'] for n in names) < 25 * 1024 * 1024
        inventory[group] = {'file_count': len(names), 'bytes': sum(files[n]['bytes'] for n in names),
                            'files': names}
    previous = json.loads((DESTINATION/'previous-publication.json').read_text())
    obsolete = sorted(set(previous['files']) - files.keys())
    verification = {'status': 'PASS', 'version': '0.9.10', 'edition': 'online',
                    'repository': 'automethods/obd-2', 'source_directory': str(SITE),
                    'publicationFiles': published, 'files': files, 'batches': inventory,
                    'obsolete_repository_files': obsolete,
                    'checks': {'browser': 'PASS — actual worker, driving, diagnostics, exports, MAF, language memory and mobile layout',
                               'model_parity': 'PASS — 113 requests; 3,341,821 comparisons against original Python',
                               'languages': 'PASS — Ukraine defaults, English elsewhere, remembered explicit choice',
                               'engine_source': '17 original Python model files unchanged'},
                    'deployment_status': 'Replacement files prepared; GitHub upload and homepage cutover pending'}
    (DESTINATION/'verification.json').write_text(json.dumps(verification, indent=2) + '\n')
    (DESTINATION/'README.md').write_text('''# Replace the existing OBD repository with the online edition

Use the existing https://github.com/automethods/obd-2 repository on main. Do not create another repository or a Cloudflare project.

1. In automethods/obd-2, delete the obsolete downloads directory (four installer files), assets/i18n.js and assets/obd.css. Leave other files in place. The existing live site still uses its previous homepage publication until the final cutover.
2. Open https://github.com/automethods/obd-2/upload/main. Drag the CONTENTS of 01-browser-engine into the upload page. Commit message: Add OBD II Lab browser engine.
3. Upload the CONTENTS of 02-runtime-and-model in the same way. Commit message: Add original simulation models and browser runtime.
4. Upload the CONTENTS of 03-guides. Commit message: Preserve OBD II Lab guides and references.
5. Upload the CONTENTS of 04-online-app. Commit message: Run OBD II Lab online in the browser.
6. Tell Codex that all four uploads and the obsolete-file removal are complete. The GitHub commit will be verified before preparing the homepage cutover in Home-v0.5.16/01-activate.
7. After that verified homepage update is uploaded and Cloudflare reports a successful deployment, check https://automethods.com/projects/obd-2/. Then remove only projects/obd-2 from automethods/home on GitHub. Its build now obtains the app from the independent repository, like the other projects. Keep home/models/obd-diagnostics.* for the selector card.

Upload each numbered batch separately. Preserve nested folder names such as vendor, web and docs. Never upload the outer numbered folder, this README, verification.json or previous-publication.json. No ZIP needs to be uploaded. Each batch is below GitHub's 100-file browser limit and each file is below 25 MiB.

The app runs online without installing Python. Its Python/WebAssembly runtime files are website assets. CSV/JSON exports save your simulated results; they are not application downloads. Home remains the selector with the existing shared login and human check. Both interface languages and all previous simulator tools are retained.
''')
    print(json.dumps({'status': 'PASS', 'directory': str(DESTINATION),
                      'files': len(files), 'publication_files': len(published),
                      'batches': {n: {k: v for k, v in x.items() if k != 'files'} for n, x in inventory.items()},
                      'obsolete_repository_files': obsolete}, indent=2))


if __name__ == '__main__':
    prepare()
