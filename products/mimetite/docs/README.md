# Hello!

Here you will find the knowledge base for mimetite. It's
easy to get started in mimetite with just a few lines
of YAML. However, the real power comes from the dozens
of configuration options to control routing and resource
loading exactly as you want it.

mimetite doesn't come with traditional documentation.
Instead, it includes a documentation agent that reads from
the knowledge base to answer your questions directly.

Three steps to get started:

1. Download gemma-4-12B
2. Install llama-server
3. Write your first configuration file and start mimetite

## Downloading gemma-4-12B

Docs is evaluated against a gemma-4-12B Q4_K_M from Unsloth.
It is a small and capable model that most people can run even
if they don't have a GPU.

Download it form https://huggingface.co/unsloth/gemma-4-12b-it-GGUF

```bash
uvx hf download unsloth/gemma-4-12b-it-GGUF gemma-4-12b-it-Q4_K_M.gguf --local-dir .

# download MTP
uvx hf download unsloth/gemma-4-12b-it-GGUF MTP/mtp-gemma-4-12b-it-Q8_0.gguf --local-dir .
```

## Installing llama-server

(find instructions for your os) - to be written.

## Installing mimetite

(to be written)

## config.yaml

Use this minimal configuration to get gemma-4-12B running to
power the Docs agent.

```yaml
models:
  gemma-4-12B:
    filters:
      stripParams: "temperature, top_k, top_p, repeat_penalty, min_p, presence_penalty"
      capabilities:
        tools: true
      cmd: |
        /path/to/llama-server-latest
        --host 127.0.0.1 --port ${PORT}
        --log-verbosity 4 --log-colors on
        --temp 1.0 --top-p 0.95 --top-k 64

        # model params
        --model /path/to/gemma-4-12b-it-Q4_K_M.gguf
        --model-draft /path/to/mtp-gemma-4-12b-it-Q8_0.gguf

        # enable MTP
        --spec-type draft-mtp
        --spec-draft-n-max 4 --spec-draft-p-min 0.75
```

## Run mimetite

Start up mimetite and visit http://localhost:8080

```bash
mimetite -config config.yaml -listen localhost:8080
```
## Historical

Older audits and merge records live in [docs/history/](history/):
`README_FLOCK_V2.md` (retired in-process router), `README_ASTMATRIX_V2.md`,
`MODEL_INVENTORY.md` (2026-07/09 model audit, partially stale — see its
CORRECTIONS header), `MERGE-DECISIONS.md`, `model-profiles.md`.
