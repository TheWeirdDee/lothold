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

**Status on 24 Oct 2026:**

- The label parser is verified by unit, integration and browser tests.
- A Google AI Studio (Gemini) key is configured through the OpenAI-compatible adapter:
  - `AI_PROVIDER=openai-compatible`
  - `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`
  - `AI_MODEL=gemini-3.8-flash`
- The key authenticates (`GET /models` returned HTTP 200 and listed the model).
- A live extraction through the application did **not** succeed:
  - The app's extraction request got **HTTP 503** (Google: "temporarily overloaded or down").
  - A diagnostic structured-output call then timed out after 90 s.
  - A minimal diagnostic call got **HTTP 429**: `generate_content_free_tier_requests, limit: 20` per day for `gemini-3.8-flash`. The limit is non-zero, so this is an exhausted daily quota, not a project with no free-tier access.
  - Limits are per Google Cloud project, and this work sent only 4 generate requests, so other usage in the same project probably used most of the quota.
  - Work stopped there, with no retries and no billing.
- During those attempts, the app's fallback was verified live:
  - The result was labelled "Label parser (deterministic, not AI)".
  - Injected values were refused.
  - Missing fields stayed missing.
  - Nothing applied before human acceptance.
  - Error text contained no key.
- **Live AI is unverified**, and stays so until a model extraction succeeds through the application and its page and quote references are checked. The script only reports `verified: true` in that case. The record is in `docs/evidence/ai-live-verification.json`. Daily quotas reset at midnight Pacific time (Google rate-limits page, updated 2026-10-15), which is 07:00 UTC on 25 Oct 2026. After that, run `node --env-file=.env scripts/ai-live-verify.ts` once. It sends at most 2 provider requests, and only 1 if the provider refuses the first.

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

**Google Gemini (Google AI Studio key)**, using Google's OpenAI-compatible endpoint (https://ai.google.dev/gemini-api/docs/openai, page updated 2026-10-22; structured output is supported there through `response_format`):

```
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_MODEL=gemini-3.8-flash
AI_API_KEY=<your Google AI Studio key>
```

Free-tier limits are low (20 generate requests per day for this model at the time of testing), and Google may use free-tier requests to improve its products. Only send documents you are permitted to share.

**Other OpenAI-compatible endpoints** (any provider implementing `/chat/completions` with `response_format: json_schema`):

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
