"""Build portable VSIX and desktop ZIP from this checkout; no account files read."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json
import re
import shutil
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'claude-monitor'
DIST = ROOT / 'dist'
PACKAGE = json.loads((SOURCE / 'package.json').read_text(encoding='utf-8'))
VERSION = PACKAGE['version']
BINARY = ROOT / 'build' / 'ClaudeMonitor.exe'
FILES = ['package.json', 'extension.js', 'core.js', 'bridge.js', 'quota.js', 'setup.js',
         'snapshot.js', 'desktop.js', 'desktop.xaml', 'widget.xaml', 'theme.xaml',
         'claude.ico', 'claude.png', 'claude-mark.svg', 'monitor.svg', 'README.md', 'LICENSE']
PLUGIN_FILES = ['.claude-plugin/plugin.json', '.claude-plugin/icon.svg',
                'hooks/hooks.json', 'hooks/register.js', 'README.md']

def vsix_manifest():
    ns = 'http://schemas.microsoft.com/developer/vsx-schema/2011'
    ET.register_namespace('', ns)
    def child(parent, tag, text=None, **attributes):
        element = ET.SubElement(parent, '{'+ns+'}'+tag, attributes)
        if text is not None:
            element.text = text
        return element
    root = ET.Element('{'+ns+'}PackageManifest', Version='2.0.0')
    meta = child(root, 'Metadata')
    child(meta, 'Identity', Language='en-US', Id=PACKAGE['name'], Version=VERSION,
          Publisher=PACKAGE['publisher'])
    child(meta, 'DisplayName', PACKAGE['displayName'])
    child(meta, 'Description', PACKAGE['description'])
    child(meta, 'License', 'extension/LICENSE')
    properties = child(meta, 'Properties')
    for key, value in {'Engine': PACKAGE['engines']['vscode'],
                       'ExtensionDependencies': '', 'ExtensionPack': '',
                       'ExtensionKind': 'workspace', 'ExecutesCode': 'true'}.items():
        child(properties, 'Property', Id='Microsoft.VisualStudio.Code.'+key, Value=value)
    installation = child(root, 'Installation')
    child(installation, 'InstallationTarget', Id='Microsoft.VisualStudio.Code')
    child(root, 'Dependencies')
    assets = child(root, 'Assets')
    for kind, file in [('Microsoft.VisualStudio.Code.Manifest', 'package.json'),
                       ('Microsoft.VisualStudio.Services.Content.Details', 'README.md'),
                       ('Microsoft.VisualStudio.Services.Content.License', 'LICENSE')]:
        child(assets, 'Asset', Type=kind, Path='extension/'+file, Addressable='true')
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)

def content_types():
    ns = 'http://schemas.openxmlformats.org/package/2006/content-types'
    ET.register_namespace('', ns)
    root = ET.Element('{'+ns+'}Types')
    for suffix, mime in {'json':'application/json', 'js':'application/javascript',
                         'xaml':'text/xml', 'svg':'image/svg+xml', 'md':'text/markdown',
                         'ico':'image/x-icon', 'png':'image/png', 'exe':'application/octet-stream',
                         'vsixmanifest':'text/xml', 'xml':'text/xml'}.items():
        ET.SubElement(root, '{'+ns+'}Default', Extension=suffix, ContentType=mime)
    for name in ['LICENSE', 'NOTICE']:
        ET.SubElement(root, '{'+ns+'}Override', PartName='/extension/'+name, ContentType='text/plain')
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)

def marketplace_files():
    """(origem, caminho relativo) do marketplace local com o plugin observador."""
    yield ROOT/'.claude-plugin'/'marketplace.json', '.claude-plugin/marketplace.json'
    for name in PLUGIN_FILES:
        yield ROOT/'claude-monitor-bridge'/name, 'claude-monitor-bridge/'+name

def script(name):
    """Script PowerShell com BOM (o Windows PowerShell 5.1 precisa dele para ler acentos)."""
    text = (ROOT/'scripts'/name).read_text(encoding='utf-8-sig')
    return re.sub(r"\$taskVersion = '[^']*'", "$taskVersion = '"+VERSION+"'", text)

def main():
    if not BINARY.is_file():
        raise SystemExit('Compile primeiro: ./scripts/build.ps1')
    DIST.mkdir(parents=True, exist_ok=True)
    vsix = DIST / ('claude-monitor-local-'+VERSION+'.vsix')
    with ZipFile(vsix, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('extension.vsixmanifest', vsix_manifest())
        archive.writestr('[Content_Types].xml', content_types())
        for name in FILES:
            archive.write(SOURCE/name, 'extension/'+name)
        archive.write(BINARY, 'extension/ClaudeMonitor.exe')
        archive.write(ROOT/'NOTICE', 'extension/NOTICE')
        for source, name in marketplace_files():
            archive.write(source, 'extension/marketplace/'+name)
    with ZipFile(vsix) as archive:
        assert archive.testzip() is None
        ET.fromstring(archive.read('extension.vsixmanifest'))
        ET.fromstring(archive.read('[Content_Types].xml'))
        assert json.loads(archive.read('extension/package.json'))['version'] == VERSION
    full = DIST / ('Claude-Monitor-'+VERSION+'.zip')
    with tempfile.TemporaryDirectory(prefix='package-', dir=DIST) as temporary:
        stage = Path(temporary)
        assert stage.resolve().is_relative_to(DIST.resolve())
        bundle = stage / ('Claude-Monitor-'+VERSION)
        app = bundle/'app'
        app.mkdir(parents=True)
        for name in FILES:
            shutil.copy2(SOURCE/name, app/name)
        shutil.copy2(BINARY, app/'ClaudeMonitor.exe')
        shutil.copy2(ROOT/'NOTICE', app/'NOTICE')
        shutil.copy2(vsix, bundle/vsix.name)
        shutil.copy2(ROOT/'README.md', bundle/'LEIA-ME.md')
        for name in ['Instalar.ps1', 'Desinstalar.ps1']:
            (bundle/name).write_text(script(name), encoding='utf-8-sig', newline='\r\n')
        (bundle/'Instalar.cmd').write_text((ROOT/'scripts'/'Instalar.cmd').read_text(encoding='utf-8'), encoding='ascii', newline='\r\n')
        for source, name in marketplace_files():
            dest = bundle/'marketplace'/name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, dest)
        with ZipFile(full, 'w', ZIP_DEFLATED) as archive:
            for file in sorted(bundle.rglob('*')):
                if file.is_file():
                    archive.write(file, file.relative_to(stage).as_posix())
    with ZipFile(full) as archive:
        assert archive.testzip() is None
        assert not any('.runtime/' in name or '.credentials' in name for name in archive.namelist())
    sums = [hashlib.sha256(file.read_bytes()).hexdigest()+'  '+file.name for file in [vsix, full]]
    (DIST/'SHA256SUMS.txt').write_text('\n'.join(sums)+'\n', encoding='utf-8')
    print('Pacotes criados em dist/: '+vsix.name+' e '+full.name)

if __name__ == '__main__':
    main()
