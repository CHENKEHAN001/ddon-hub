@echo off
rem 以局域网可访问模式启动，供同一 WiFi 下的手机/平板打开。
rem
rem 默认模式只监听 127.0.0.1，手机连不上；这个脚本加了 --lan。
rem 注意：页面没有密码，同一网络下谁能打开地址，谁就能看数据和改备注。
rem 家里的 WiFi 没问题；公共 WiFi 上别用。

cd /d "%~dp0"

rem 允许入站（第一条会弹一次 UAC 提权框，同意一次即可；拒绝了也不影响本机使用）
netsh advfirewall firewall show rule name="DDON 资料站 8777" >nul 2>&1
if errorlevel 1 (
  echo 正在添加防火墙放行规则（会弹出一次管理员确认）...
  powershell -NoProfile -Command "Start-Process netsh -ArgumentList 'advfirewall firewall add rule name=\"DDON 资料站 8777\" dir=in action=allow protocol=TCP localport=8777' -Verb RunAs -Wait" 2>nul
)

echo.
echo 正在启动，稍后窗口里会列出手机可以打开的地址（形如 http://192.168.x.x:8777/）...
echo.

"%~dp0ddon-hub-portable.exe" --lan %*

if errorlevel 1 (
  echo.
  echo 启动失败。可执行文件可能被杀毒软件拦了，或 8777 端口被占用。
  echo 试试换个端口：在本文件上右键 -^> 编辑，把 --lan 改成 --lan --port 8899
  echo.
  pause
)
