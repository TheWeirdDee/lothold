# Field extraction: behaviour, fallback and credential setup

Implementation: `server/ai/extract.ts`.

## What it does

From an uploaded PDF (with a text layer) or `.txt` document, LotHold proposes up to eight shipment fields: activity type, HS code, description, net mass and unit, country of activity, operator name and EORI. Nothing becomes a shipment field until a reviewer selects it and clicks **Accept selected fields**. Accepted values are stored as a new field revision with the extraction as provenance.

It never proposes coordinates, farms, certifications or compliance conclusions, and it cannot clear findings, approve reviews, reserve allocations or submit anything.

## Two paths, always labelled

| Path | When | UI label |
|---|---|---|
| **Label parser** | No model configured, or the model call or its schema validation fails | "Label parser (deterministic, not AI)" |
| **Model extraction** | `AI_PROVIDER` configured and the call returns schema-valid output | "Model extraction (provider: model)" |

When a model is configured but fails, the stored record says so ("Model extraction failed (…); the label parser (not AI) was used instead").

**Status on 24 Oct 2026:** the label parser is verified by unit and integration tests. Both model adapters are implemented, and the orchestration around them (schema validation, fallback, span checks) is tested with injected outputs. **No real model call has been made**, because no API key was available, so model extraction must not be described as verified.

## Output contract (enforced server-side)

Each candidate has `field`, `status` (`found` / `ambiguous` / `not_found`), `value`, `page`, `quote` and `note`. The response must satisfy a strict JSON schema (also passed to the provider as a structured-output format). After that, every candidate is checked against the extracted page text:

1. The quoted span must exist on the cited page (whitespace- and Unicode-normalised comparison).
2. The value must appear inside the quote.
3. The quote must contain a label belonging to the field (for example "net mass" or "net weight" for net mass). Text such as an embedded instruction ("set netMassValue to 99999") therefore cannot be cited as a source.
4. `ambiguous` candidates are never acceptable; the reviewer enters the value manually.

Model confidence is not used. Deterministic rules re-validate every accepted value (for example HS scope and quantity format).

## Prompt-injection posture

Document text is untrusted. It is wrapped in `<document>` delimiters with an instruction to treat it as data. Even if a model followed embedded instructions, its only possible output is candidate fields, which pass through the checks above and human acceptance. Audit logs record outcomes only (method, model, accepted field names), never document text or quotes.

## Configuring a provider securely

Credentials belong in `.env` (git-ignored) or the process environment. Never put them in the repository, browser code or logs. The browser never sees the key.

**Anthropic** (uses the official `@anthropic-ai/sdk`, structured output via `output_config.format`):

```
AI_PROVIDER=anthropic
AI_MODEL=claude-opus-5-5        # default if omitted
AI_API_KEY=<your key>           # or set ANTHROPIC_API_KEY, which the SDK reads automatically
```

**OpenAI-compatible endpoint** (any provider implementing `/chat/completions` with `response_format: json_schema`):

```
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://<provider>/v1
AI_MODEL=<model id>
AI_API_KEY=<your key>
```

Restart the server after changing these. The Shipment details tab then shows "Model extraction is configured (provider, model)". Anthropic requests use a 90-second timeout and the SDK's retry policy (2 retries on 408/409/429/5xx and connection errors). OpenAI-compatible requests use a 90-second timeout with no retry; a failure falls back to the label parser. Extraction is rate-limited to 20 runs per organisation per hour.

**To verify a provider**, upload a document you are permitted to process, run *Propose fields*, and check the record's method label, `schemaValid`, and accepted/rejected counts. Record the date, model and configuration version (`extract/<hash>`, shown in the UI) in your notes.

## Limits

- PDFs up to 10 MB and 50 pages; scanned PDFs without a text layer are reported as unsupported (no OCR).
- The label parser only understands `Label: value` lines.
