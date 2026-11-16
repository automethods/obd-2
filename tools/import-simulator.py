"""Import the existing simulator into the self-contained browser publication."""
import argparse
import hashlib
import json
import posixpath
from pathlib import Path
import re
import shutil
import zipfile


SITE = Path(__file__).resolve().parents[1]


def rewrite_html(text, relative):
    parent = posixpath.dirname(relative)
    prefix = posixpath.relpath('.', parent or '.')
    prefix = '' if prefix == '.' else prefix + '/'
    def url(match):
        value = match[2]
        if value == '/':
            value = prefix or './'
        elif value.startswith(('/web/', '/docs/', '/OBDII_', '/START_HERE.html')):
            value = prefix + value[1:]
        return match[1] + value + match[3]
    return re.sub(r'((?:src|href)=["\'])(/[^"\']*)(["\'])', url, text)


def online_shell(text, prefix=''):
    head = (f'<link rel="icon" href="{prefix}assets/favicon.svg" type="image/svg+xml">'
            f'<link rel="stylesheet" href="{prefix}online/online.css">'
            f'<script src="{prefix}assets/language.js"></script>'
            f'<script src="{prefix}online/bridge.js"></script>')
    if '</head>' in text:
        text = text.replace('</head>', head + '</head>', 1)
    else:
        text = text.replace('<style>', head + '<style>', 1)
    loading = ('<div id="online-startup" data-i18n-skip role="status" aria-live="polite">'
               '<span data-online-status>Starting OBD II Lab…</span>'
               '<button type="button" hidden>Try again</button></div>')
    if '<body' in text:
        text = re.sub(r'(<body[^>]*>)', r'\1' + loading, text, count=1)
    else:
        text = text.replace('<header>', loading + '<header>', 1)
    return text


def online_guide(text):
    text = text.replace('0.9.7', '0.9.10')
    text = text.replace('Vehicle, workspace and local testing guide', 'Vehicle, workspace and browser testing guide')
    text = re.sub(r'<section id="start">.*?(?=<section)', '''<section id="start"><h2>Open the online lab</h2>
<p>Open <a href="../">OBD II Lab</a> in your browser and wait for the simulation engine to load. Choose a vehicle, apply its settings, then select Drive or Diagnostics &amp; service. Python runs inside a browser worker; no installation or terminal is needed.</p>
<p>Ukraine defaults to Ukrainian; other countries default to English. Choose EN / Українська to save your own preference across AutoMethods.</p>
<p>The vehicle and its recordings belong to this browser tab. Export wanted data before reloading, resetting or changing the vehicle. Closing the tab ends that simulation.</p></section>
''', text, count=1, flags=re.S)
    text = text.replace('This is a local browser application served by Python, not a native desktop installer. No Electron, Node or Rust installation is needed to run the download.',
                        'This is an online browser application. The original Python simulation engine runs in a browser worker through WebAssembly; no application installation is needed.')
    text = text.replace('45 local checks', '45 browser checks').replace('45 local acceptance checks', '45 browser acceptance checks')
    text = text.replace('Python: __________', 'Browser runtime: __________')
    text = text.replace('Run bash run.sh from the downloaded folder. Expect version 0.9.10 and step 1, Vehicle, with no operational mode tabs, simulation controls or automatic engine start. Check the page works without internet.',
                        'Open the online lab and wait for the engine to load. Expect version 0.9.10 and step 1, Vehicle, with no operational mode tabs, simulation controls or automatic engine start.')
    text = text.replace('Export wanted data, then press Ctrl+C in the terminal. The local server should stop and temporary working files be removed. Relaunch the same run.sh; the OBD download folder still needs only run.sh and START_HERE.txt.',
                        'Export wanted data, then close the tab. Reopen the online lab: a fresh vehicle starts without installing or launching anything on your computer.')
    text = text.replace('navigation and local tests', 'navigation and browser checks')
    text = text.replace('Use the local checks below.', 'Use the browser checks below.').replace('The local checklist', 'The browser checklist')
    return text


def build(source):
    original_hashes = {}
    for folder in ['web', 'docs']:
        for path in sorted((source / folder).rglob('*')):
            if not path.is_file() or '__pycache__' in path.parts:
                continue
            relative = path.relative_to(source).as_posix()
            target = SITE / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if path.suffix == '.html':
                content = rewrite_html(path.read_text(), relative)
                if relative in ['web/index.html', 'web/article-experiment.html']:
                    content = content.replace('/ local simulation', '/ online simulation')
                    content = content.replace('Current workspace guide & local checks', 'Workspace guide')
                    content = online_shell(content, '../')
                if relative == 'docs/WORKSPACE.html':
                    content = online_guide(content)
                target.write_text(content)
            else:
                shutil.copy2(path, target)
    for path in source.glob('*.pdf'):
        shutil.copy2(path, SITE / path.name)
    start = rewrite_html((source / 'START_HERE.html').read_text(), 'START_HERE.html')
    (SITE / 'START_HERE.html').write_text(start.replace('url=/docs/', 'url=docs/'))
    html = rewrite_html((source / 'web/index.html').read_text(), 'index.html')
    html = html.replace('/ local simulation', '/ online simulation')
    html = html.replace('Current workspace guide & local checks', 'Workspace guide')
    html = html.replace('<div class="app-brand">', '<a class="online-home" href="https://automethods.com/#catalogue" title="Back to AutoMethods" aria-label="Back to AutoMethods">←</a><div class="app-brand">', 1)
    (SITE / 'index.html').write_text(online_shell(html))
    language = (SITE / 'web/i18n.js').read_text()
    language = language.replace("return supported(query)?query:supported(saved)&&saved!==automatic?saved:browser||'en';",
                                "return supported(query)?query:supported(saved)&&saved!==automatic?saved:window.AutoMethodsLanguage?.language||'en';")
    language = re.sub(r"    const browser=\(navigator\.languages.*?;\n", '', language)
    (SITE / 'web/i18n.js').write_text(language)
    dictionary = (SITE / 'web/i18n-uk.js').read_text()
    dictionary = dictionary.replace('"/ local simulation": "/ локальне моделювання"', '"/ online simulation": "/ онлайн-моделювання"')
    dictionary = dictionary.replace('window.OBDUkrainian={', 'window.OBDUkrainian={\n  "Back to AutoMethods": "До АвтоМетоду",\n  "Workspace guide": "Довідник робочого середовища",\n  "Vehicle updates are paused. Use the vehicle controls to continue.": "Оновлення автомобіля призупинено. Продовжте за допомогою елементів керування.",\n  "Vehicle updates paused": "Оновлення автомобіля призупинено",', 1)
    (SITE / 'web/i18n-uk.js').write_text(dictionary)
    cockpit = (SITE / 'web/cockpit.js').read_text().replace('Vehicle updates are paused. Check the local server connection.', 'Vehicle updates are paused. Use the vehicle controls to continue.')
    (SITE / 'web/cockpit.js').write_text(cockpit)
    monitor = (SITE / 'web/vehicle-monitor.js').read_text().replace('Vehicle updates paused · check the local server connection', 'Vehicle updates paused')
    (SITE / 'web/vehicle-monitor.js').write_text(monitor)
    session = (SITE / 'web/session.js').read_text().replace('The local simulator did not respond.', 'The simulator did not respond.')
    (SITE / 'web/session.js').write_text(session)
    # Preserve the original model bytes for the browser and for provenance.
    model = SITE / 'model-src'
    for path in sorted((source / 'obdii_lab').glob('*.py')):
        relative = path.relative_to(source)
        target = model / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        original_hashes[relative.as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    for path in [*(source / 'data').glob('*.json'), source / 'web/models/diagnostic_definitions.json', *(source / 'docs').glob('*.html')]:
        target = model / path.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    (SITE / 'python').mkdir(exist_ok=True)
    with zipfile.ZipFile(SITE / 'python/model.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(model.rglob('*')):
            if path.is_file():
                archive.write(path, path.relative_to(model))
    (SITE / 'model-provenance.json').write_text(json.dumps({'engine_version': '0.9.10', 'model_files_unchanged': original_hashes, 'transport': 'browser worker; original handlers over in-memory streams'}, indent=2) + '\n')
    print(json.dumps({'engine_files': len(original_hashes), 'model_archive_bytes': (SITE / 'python/model.zip').stat().st_size}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    build(parser.parse_args().source.resolve())
