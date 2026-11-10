param([string]$OutputPath='')
$ErrorActionPreference='Stop'
$taskFramework=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$taskRoot=$PSScriptRoot
if(-not $OutputPath){$OutputPath=Join-Path $taskRoot 'ClaudeMonitor.exe'}
& "$taskFramework\csc.exe" /nologo /target:winexe /optimize+ "/out:$OutputPath" "/win32icon:$taskRoot\claude.ico" "/reference:$taskFramework\WPF\PresentationFramework.dll" "/reference:$taskFramework\WPF\PresentationCore.dll" "/reference:$taskFramework\WPF\WindowsBase.dll" "/reference:$taskFramework\System.Xaml.dll" "/reference:$taskFramework\System.Web.Extensions.dll" "/reference:$taskFramework\System.Windows.Forms.dll" "/reference:$taskFramework\System.Drawing.dll" "$taskRoot\native\Monitor.cs"
if($LASTEXITCODE -ne 0){throw 'A compilação falhou.'}
