Put a Python Windows installer here and rename it to:

python-installer.exe

Recommended source:
https://www.python.org/downloads/windows/

The one-click launcher will use this file when the target computer does not have Python.

For offline computers, also prepare Python package wheels in:

vendor\wheels

For this app, requirements.txt currently needs:

openpyxl

If vendor\wheels exists, the launcher installs packages from that folder without internet.

Alternative:
Put a portable Python at:

.runtime\python\python.exe

If that file exists, the launcher will use it first and will not install Python into Windows.
