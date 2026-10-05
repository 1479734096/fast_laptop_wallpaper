@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title 动态壁纸生成工具
echo ===================================================================
echo                     动态壁纸生成与配色刷新
echo ===================================================================
echo 无参数时处理 input 文件夹；也可传入生成参数或 --refresh-theme 工程目录。
echo.
python "%~dp0pipeline.py" %*
set "wallpaper_exit_code=%errorlevel%"
echo.
if not "%wallpaper_exit_code%"=="0" echo 执行失败，退出码：%wallpaper_exit_code%
pause
exit /b %wallpaper_exit_code%
