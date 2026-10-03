"""Shared sys.path setup so the eval scripts can `import orbital`.

See evals/conftest.py for why the harness is not inside the science package.
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCIENCE = REPO_ROOT / "science"
if str(SCIENCE) not in sys.path:
    sys.path.insert(0, str(SCIENCE))
