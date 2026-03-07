@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo     TagForge Environment Installer
echo ========================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python was not found in the PATH.
    echo Please install Python 3.11.8 or higher from the website python.org
    echo and make sure that the "Add Python to PATH" option is checked.
    pause
    exit /b 1
)

for /f "tokens=2" %%i in ('python --version 2^>^&1') do set pyver=%%i
echo Python version found: %pyver%
echo.

if not exist requirements.txt (
    echo [ERROR] File requirements.txt not found in the current folder.
    pause
    exit /b 1
)

if not exist venv\Scripts\python.exe (
    echo Creating a virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo [ERROR] The virtual environment could not be created.
        pause
        exit /b 1
    )
) else (
    echo The virtual environment already exists.
)

echo Installing dependencies from requirements.txt ...
call venv\Scripts\activate.bat
if errorlevel 1 (
    echo [ERROR] The virtual environment could not be activated.
    pause
    exit /b 1
)

python -m pip install --upgrade pip >nul
pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Error when installing dependencies.
    pause
    exit /b 1
)

call deactivate

echo Creating a run.bat startup file...
> run.bat echo @echo off
>> run.bat echo chcp 65001 ^>nul
>> run.bat echo echo Launching TagForge...
>> run.bat echo echo.
>> run.bat echo call "%%~dp0venv\Scripts\activate.bat"
>> run.bat echo if errorlevel 1 (
>> run.bat echo     echo [ERROR] The environment could not be activated.
>> run.bat echo     pause
>> run.bat echo     exit /b 1
>> run.bat echo )
>> run.bat echo echo Opening browser...
>> run.bat echo start /b "" cmd /c "start http://127.0.0.1:5000"
>> run.bat echo python app.py
>> run.bat echo if errorlevel 1 (
>> run.bat echo     echo.
>> run.bat echo     echo [ERROR] The program has terminated with an error.
>> run.bat echo     pause
>> run.bat echo )
>> run.bat echo deactivate

echo.
echo ========================================
echo The installation is complete!
echo Now you can run the program by double-clicking on the run.bat file.
echo ========================================
pause