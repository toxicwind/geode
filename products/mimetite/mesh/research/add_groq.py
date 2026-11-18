#!/usr/bin/env python3
"""Sync groq provider models from the canonical catalog (generated/providers.json).

Groq's dead models (llama-3.3-70b-versatile, qwen/qwen3-32b, qwen/qwen3.6-27b,
meta-llama/llama-4-scout-17b-16e-instruct) live in DEAD_MODEL_IDS and must
never be re-added here. This script reads the canonical catalog so dead models
stay dead.
"""
import json, sys

CATALOG = "/home/toxic/pens/geode/products/mimetite/generated/providers.json"
ROUTER = "/home/toxic/sovereign/tools/ast-matrix/sovereign-ast-matrix/router.py"

with open(CATALOG) as f:
    catalog = json.load(f)

groq = None
for p in catalog["providers"]:
    if p["name"] == "groq":
        groq = p
        break

if not groq:
    print("WARN: groq provider not found in catalog", file=sys.stderr)
    sys.exit(1)

models = groq.get("staticModels") or groq.get("seeds") or []
# Drop any dead IDs that might still appear in seeds.
dead = set(catalog.get("deadIds", []))
models = [m for m in models if m not in dead]

print(f"Catalog groq models (alive): {models}")

# Build PROVIDER_MODELS block
models_block = '    "groq": [\n'
for m in models:
    models_block += f'        "{m}",\n'
models_block += '    ],'

aliases_block = ""
for alias, [prov, mid] in catalog.get("aliases", {}).items():
    if prov == "groq":
        aliases_block += f'    "{alias}": ("groq", "{mid}"),\n'

with open(ROUTER) as f:
    src = f.read()

count = 0
start = src.find('    "groq": [')
if start != -1:
    end = src.find("]", start)
    if end != -1:
        src = src[:start] + models_block + src[end+1:]
        count += 1
        print("OK: updated PROVIDER_MODELS groq")
else:
    print("WARN: groq PROVIDER_MODELS block not found in router")

if aliases_block:
    anchor = "    # Groq"
    if anchor in src:
        src = src.replace(anchor, aliases_block.rstrip("\n") + "\n" + anchor, 1)
        count += 1
        print("OK: added groq CODING aliases")
    else:
        print("WARN: could not find groq alias anchor in router")

if count > 0:
    with open(ROUTER, "w") as f:
        f.write(src)
    print(f"\nPatched {count} section(s)")
else:
    print("\nNo patches applied")
