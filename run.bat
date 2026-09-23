@echo off
cd /d "%~dp0"
chcp 65001 >nul
title 16:10 4K Wallpaper Pipeline
echo ===================================================================
echo        Laptop 16:10 4K Wallpaper Generator (Auto-Pipeline)
echo ===================================================================
echo.
python pipeline.py
echo.
pause
