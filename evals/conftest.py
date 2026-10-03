"""Make the science package importable from the eval harness.

DECISION (ADR-007): the harness lives OUTSIDE `science/` even though it imports
`orbital.py` directly. `science/Dockerfile` does `COPY . .`, so anything placed
in that package ships to production — eval datasets, judge prompts and test
dependencies included. Three lines of sys.path is a smaller cost than a larger
production image containing the grader for the thing it grades.
"""
import sys
from pathlib import Path

SCIENCE = Path(__file__).resolve().parent.parent / "science"
if str(SCIENCE) not in sys.path:
    sys.path.insert(0, str(SCIENCE))
