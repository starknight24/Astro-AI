# Eval corpus

The three papers the RAG eval runs against are **not committed** — they are
third-party arXiv PDFs. Download them (≈3 MB total):

```bash
cd evals/papers
curl -sL -o 2609.24534v1.pdf "https://arxiv.org/pdf/2609.24534v1"   # FACSAT-2 orbital decay
curl -sL -o 2609.23496v1.pdf "https://arxiv.org/pdf/2609.23496v1"   # Earth-Moon 3D transfers
curl -sL -o 2609.36042v1.pdf "https://arxiv.org/pdf/2609.36042v1"   # X-ray orbital Doppler shift
```

Or point the runner elsewhere with `EVAL_PAPERS_DIR=/path/to/pdfs`.

The gold labels in `../datasets/rag_golden.json` are tied to these exact
versions (`v1`); a different revision would renumber pages and invalidate every
`gold_pages` value.
