# Open Business Bundle Format Specification v0.1.0

*Definitive Technical Standard – Production‑Ready*  
*Version 0.1.0 — Last Updated: 2026‑06‑14*

---

## 1. Introduction

### 1.1 Purpose
The Open Business Bundle (OBB) is a self‑contained, portable file format for representing business entities, their media assets, and presentation views in a single, deterministic archive. It is designed to be generated, consumed, rendered, and migrated across any platform without external dependencies.

### 1.2 Goals
- **Single Source of Truth** – style‑agnostic business data in `business.json`.
- **Multi‑View Decoupling** – presentation logic isolated in separate `views/` files.
- **Binary Asset Management** – all media bundled, referenced via `media://` protocol.
- **Deterministic Integrity** – cross‑platform hashing of file contents, independent of ZIP compression or timestamps.
- **Version‑Safe Evolution** – explicit `formatVersion` and `schemaVersion` with migration pipelines.
- **Lightweight & Standard** – ZIP + JSON, implementable in any language.
- **Security First** – strict path validation, no code execution, tamper‑proof integrity.
- **Extensibility** – `extensions/` namespace, `custom` fields.
- **Non‑blocking Performance** – async decompression, lazy media, soft‑drain memory management.

### 1.3 Non‑Goals
- Real‑time collaboration, encryption at the bundle level, binary‑delta patching.

---

## 2. Physical Bundle Structure

### 2.1 Container
An OBB file is a ZIP archive (Deflate compression, optionally uncompressed) with the custom extension `.obbiz`.
**MIME type:** `application/vnd.open-business-bundle+zip`

**ZIP filename encoding** – All entry filenames must be encoded as UTF‑8. The EFS bit (bit 11 of the general purpose bit flag) signals UTF‑8 encoding. Implementations must check this bit in the **Central Directory entry** (authoritative). If the Central Directory is missing or corrupt, fall back to the Local File Header. An entry is accepted as valid UTF‑8 if the EFS bit is set in either location. Filenames that fail UTF‑8 decode must be rejected regardless of flag state.
All filenames decoded from UTF‑8 must be **NFC‑normalised** before path comparison or hashing (§7.2).

### 2.2 Directory Layout

```
company-workspace.obbiz
├── manifest.json
├── business.json
├── media/                         # Subdirectories allowed
│   ├── branding/
│   │   └── logo.png
│   ├── team/
│   │   └── alex-avatar.jpg
│   └── products/
│       ├── dashboard.webp
│       └── screenshot-1.png
├── views/
│   ├── business-plan.json
│   └── pitch-deck.json
└── extensions/                    # Optional vendor data
    └── myplugin/
        ├── config.json
        └── media-references.json  # Explicit asset declaration (§8.1.1)
```

**Path character rules (per segment):**
Each path segment may contain only `a‑z`, `A‑Z`, `0‑9`, `-`, `_`, and `.` (single dot). The segment `..` (double dot) is **explicitly forbidden** in any position. Path traversal sequences (`../`, `..\`) and null bytes (`\x00`, `%00`) are likewise forbidden. Implementations must reject any bundle whose ZIP entries violate these rules (`PATH_TRAVERSAL` error).
All paths are relative; no absolute paths (starting with `/`) allowed.

---

## 3. Core Metadata Layer (`manifest.json`)

### 3.1 Schema

```json
{
  "fileFormat": "open-business-bundle",
  "formatVersion": "0.1.0",
  "schemaVersion": "0.1.0",
  "projectId": "urn:obb:project:01J3Z8VTYKABCDEF01234567AB",
  "createdAt": "2026-03-15T08:00:00Z",
  "updatedAt": "2026-06-14T09:00:00Z",
  "generator": { "name": "example-generator", "version": "1.0.0" },
  "locales": ["en"],
  "integrity": {
    "algorithm": "sha256",
    "hash": "9f86d081...",
    "files": {
      "business.json": "e3b0c44...",
      "views/business-plan.json": "a7ffc6f...",
      "media/branding/logo.png": "1d0258c..."
    }
  },
  "custom": {}
}
```

### 3.2 Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fileFormat` | string | Yes | Fixed value `"open-business-bundle"`. |
| `formatVersion` | string | Yes | SemVer of the **container/ZIP layout** spec. Changes when directory structure or manifest shape evolve. |
| `schemaVersion` | string | Yes | SemVer of the **`business.json` and view schemas**. Increments when the data model changes. Migration is keyed on this field. |
| `projectId` | string | Yes | URN in the form `urn:obb:project:<ULID>` where `<ULID>` is a 26‑character Crockford Base32‑encoded ULID (unique, sortable). |
| `createdAt` | string | Yes | ISO 8601 UTC timestamp of initial creation. |
| `updatedAt` | string | Yes | ISO 8601 UTC timestamp of last modification. |
| `generator` | object | No | Informational only; must not influence trust. `name` and `version` are strings. |
| `locales` | string[] | No | BCP 47 language tags representing the locales used in the business data. First entry is the primary locale. |
| `integrity.algorithm` | string | No* | Hash algorithm; only `"sha256"` is defined. |
| `integrity.hash` | string | No* | Self‑hash of the manifest (see §3.3). |
| `integrity.files` | object | No* | Map of logical path → hex SHA‑256 of the file's uncompressed, NFC‑normalised content. |
| `custom` | object | No | Freeform application metadata; parsers must ignore unknown keys. |

\* If either `integrity.hash` or `integrity.files` is present, **both must be present**. If both are absent, validation is skipped (implementations should warn; strict validators may reject integrity‑free bundles).

### 3.3 Integrity Model (Deterministic)

The ZIP wrapper is **not hashed**. Instead, individual file contents are hashed, and the manifest carries a self‑hash.

1. Every file **other than `manifest.json`** inside the bundle is hashed individually after NFC normalisation and canonical serialisation (§7). Per‑file hashes are stored in `manifest.integrity.files`.
2. The manifest self‑hash is computed as:
   a. Ensure the key `integrity.hash` is **present** with its value set to `""` (do not remove the key).
   b. Apply NFC normalisation to all string values in the manifest object (§7.2).
   c. Serialise using canonical JSON (sorted keys, no insignificant whitespace; §7.1).
   d. Hash the resulting UTF‑8 bytes with SHA‑256.
   e. Set `integrity.hash` to that hex digest; re‑serialise to produce the final manifest bytes.

**Validation order:**
1. For each file listed in `integrity.files`, compute its hash and compare. Mismatch → `INTEGRITY_ERROR`.
2. Any file present in the ZIP **except `manifest.json`** that is absent from `integrity.files` → `INTEGRITY_ERROR`. `manifest.json` is excluded because its integrity is guaranteed by `integrity.hash` rather than an entry in `integrity.files`.
3. Recompute the manifest self‑hash as described and compare with `integrity.hash`. Mismatch → `INTEGRITY_ERROR`.

---

## 4. Business Data Schema (`business.json`)

### 4.1 Design Principles
- **Style‑free:** No layout, fonts, or colours.
- All media references use `media://<path>` relative to `media/` (e.g., `media://branding/logo.png`).
- Extensible via an `extensions` object.
- Serialised with canonical JSON, NFC‑normalised.

### 4.2 Core Schema (v0.1.0)

The full logical structure is defined by the type descriptions below. A formal, machine‑readable JSON Schema document, version‑matched to `manifest.schemaVersion`, accompanies this specification and is the normative reference for automated validation. The prose here is informative and describes the intent of each section.

#### 4.2.1 Global Settings

```json
{
  "currency": "USD",
  "baseLanguage": "en",
  "timezone": "America/Chicago",
  "measurementSystem": "metric"
}
```

#### 4.2.2 Identity

```json
{
  "companyName": "SaaSOptimize",
  "tagline": "AI‑Driven Operational Cloud Cost Infrastructure Metrics Extraction Layer",
  "logo": "media://branding/logo.png",
  "website": "https://saasoptimize.com",
  "socialProfiles": {
    "linkedin": "https://linkedin.com/company/saasoptimize",
    "twitter": "@saasoptimize"
  }
}
```

#### 4.2.3 Legal Profile

```json
{
  "legalName": "SaaSOptimize Technologies Inc.",
  "entityType": "C‑Corporation",
  "jurisdiction": "Delaware, USA",
  "dateFounded": "2026‑01‑10",
  "taxId": "XX‑XXXXXXX",
  "address": { "street": "...", "city": "...", "postalCode": "...", "country": "US" }
}
```

#### 4.2.4 Executive Summary

```json
{
  "mission": "...",
  "vision": "...",
  "problem": "...",
  "solution": "...",
  "elevatorPitch": "...",
  "keyHighlights": ["..."]
}
```

#### 4.2.5 Value Proposition
Array of items, each containing: `id`, `title`, `description`, optional `icon` (`media://...`), and optional `metrics`.

#### 4.2.6 Management Team
`founders`, `advisors`, `boardMembers` arrays. Each member contains: `id`, `name`, `role`, `bio`, and `imageSrc` (`media://...`).

#### 4.2.7 Products & Services
Array of offerings, each containing: `name`, `description`, `pricingModel`, `stage`, `screenshots` (array of `media://` URIs), and `features`.

#### 4.2.8 Market Analysis
Contains: `targetMarket`, `competitors`, `swot`, `marketSize`.

#### 4.2.9 Marketing Strategy
Contains: `channels`, `contentPlan`, `cacEstimate`.

#### 4.2.10 Operations
Contains: `teamSize`, `techStack`, `ipPatents`, `compliance`.

#### 4.2.11 Roadmap
Contains `milestones`, an array of objects with: `date`, `title`, `status` (`planned`, `in‑progress`, or `completed`).

#### 4.2.12 Financial Statements
Income statement, balance sheet, cash flow, and forecasts. All monetary values expressed in `global.currency`.

#### 4.2.13 Funding Requirements
Contains: `amountNeeded`, `useOfFunds`, `offeringStructure`.

#### 4.2.14 Risk Analysis
Contains `risks`, an array of objects with: `type`, `likelihood` (1‑5), `impact` (1‑5), `mitigation`.

#### 4.2.15 Appendices
Array of supporting documents, each referenced by a `media://` link.

---

## 5. View Configuration Layer

### 5.1 Overview
Views are **purely declarative layout configurations**. No conditional logic or expression evaluation is defined by the format. Dynamic decisions are the host application's responsibility.

### 5.2 View Structure

```json
{
  "viewType": "business-plan",
  "version": "1.0",
  "settings": {
    "paperSize": "a4",
    "styleConfiguration": {
      "primaryColor": "#16a34a",
      "mode": "light"
    }
  },
  "contentOrder": ["identity", "executiveSummary", "legalProfile", "valueProposition"],
  "sections": {
    "identity": { "layout": "centered-hero" }
  },
  "references": {
    "dataPaths": ["identity.logo", "managementTeam.founders[*].imageSrc"]
  }
}
```

- `contentOrder` – ordered list of section keys to render.
- `sections` – optional per‑section styling overrides.
- `references.dataPaths` – **RFC 9535 JSONPath expressions** relative to the root of `business.json`. The `$` root is implied; paths must not start with `$`. Only normalised paths and the wildcard `[*]` are used; filter expressions are unsupported and ignored.

---

## 6. Media Handling Pipeline

### 6.1 Media URI Specification
Format: `media://<path>` where `<path>` is relative to `media/`, using forward slashes, no `..`, no null bytes. Case‑sensitive.

### 6.2 Media Lifecycle Management (Soft‑Deprecation with Multi‑Generation Ref Counting)

#### 6.2.1 Ledger Structure

A **Media Ledger** manages the lifecycle of binary assets extracted from the bundle. It consists of:

- A **raw data store**, mapping a media path (relative to `media/`, e.g. `"team/alex-avatar.jpg"`) to a record containing:
  - `data` – the raw bytes of the asset.
  - `generation` – a positive integer, initially 1, incremented each time the asset is replaced.

- An **active reference list**, mapping a media path to a list of **reference entries**. Each reference entry contains:
  - `url` – a Blob URL (or local file handle) used by a consumer.
  - `refCount` – the number of active consumers of this URL (integer).
  - `mimeType` – the MIME type of the asset.
  - `generation` – the generation of the raw data this URL represents.
  - `stale` – a boolean indicating whether a newer generation exists for this path.

- A **disposed flag**, initially `false`, that prevents new Blob URL creation after shutdown.

#### 6.2.2 Obtaining a Media URL

The operation `getMediaURL(path)` returns a Blob URL for the given media path, and increments its reference count.

1. If the ledger's disposed flag is `true`, return an error with code `LEDGER_DISPOSED`.
2. Let `entries` be the list of reference entries for `path` (empty list if absent).
3. Iterate over `entries`:
   - If an entry has `stale == false`, increment its `refCount` and return its `url` immediately.
4. If no non‑stale entry exists, look up the raw data store for `path`.
   - If absent, return an error with code `UNKNOWN_MEDIA_PATH`.
5. Construct a new Blob from the stored `data` with the appropriate `mimeType`. Create a Blob URL via `URL.createObjectURL` (or platform equivalent).
6. Create a new reference entry:
   - `url` = the Blob URL
   - `refCount` = 1
   - `mimeType` = derived from the filename extension (see §6.3)
   - `generation` = the current generation from the raw data store
   - `stale` = `false`
7. Append this entry to `entries` and store back into the active reference list.
8. Return the new Blob URL.

#### 6.2.3 Asset Update

When an asset is replaced:

1. Increment the `generation` counter for that path in the raw data store, and update the stored `data` with the new bytes.
2. For every entry in the active reference list for that path, set `stale = true`.
3. **Do not forcibly revoke** existing Blob URLs. Components currently displaying the old URL continue to function.
4. Subsequent calls to `getMediaURL(path)` will find no non‑stale entry and create a fresh URL for the new data. Stale entries drain naturally when their holders call `releaseMediaURL`.

#### 6.2.4 Releasing a Media URL

The operation `releaseMediaURL(path, url)` decrements the reference count for a previously obtained URL.

1. Let `entries` be the active reference list for `path`. If absent, stop (no‑op).
2. Find the entry in `entries` where `entry.url` equals the given `url`.
3. Decrement `entry.refCount`.
4. If `refCount` reaches 0:
   - Revoke the Blob URL via `URL.revokeObjectURL(url)` (or platform equivalent).
   - Remove the entry from `entries`.
5. If `entries` is now empty, remove the path from the active reference list.

This operation is safe to call after `cleanup()` has been invoked.

#### 6.2.5 Cleanup — Soft‑Drain Shutdown

The `cleanup()` operation initiates a graceful shutdown of the media ledger.

1. Set the ledger's disposed flag to `true`. All future calls to `getMediaURL` are rejected immediately.
2. Iterate over all entries across all paths in the active reference list. For any entry where `refCount` equals 0, revoke its URL and remove the entry.
3. Return immediately. Do **not** block on entries whose `refCount` is greater than 0.

Remaining Blob URLs will be revoked automatically as components unmount and call `releaseMediaURL`. This soft‑drain pattern is safe to call at any time, even while components still hold active URLs.

---

## 7. Serialization & Determinism

### 7.1 Canonical JSON
All text files (`manifest.json`, `business.json`, `views/*.json`) must be serialised with canonical JSON:
- Object keys sorted lexicographically (Unicode code point order).
- No insignificant whitespace.
- UTF‑8 encoding.

Any stable, deterministic JSON serialiser that meets these requirements is acceptable. Implementations may use a library such as `fast-json-stable-stringify`.

### 7.2 Unicode Normalisation (NFC)

Before any text file is serialised, **all string values** within the JSON object graph must be normalised to **Unicode Normalization Form C (NFC)**. The normalisation is applied recursively:

- If the value is a **string**, return the NFC‑normalised form of that string.
- If the value is an **array**, normalise each element and return a new array.
- If the value is a **non‑null object**, normalise each property value (keys are not modified; they are ASCII in OBB‑defined schemas, but for extension data implementers should also normalise non‑ASCII keys for consistency).
- Otherwise, return the value unchanged.

This recursive process ensures that any string anywhere in the data graph is in composed form before hashing, guaranteeing cross‑platform determinism.

---

## 8. Compression & Packaging Algorithm

### 8.1 Building a Bundle (`compressOBB`)

1. **NFC normalisation** – apply NFC to all string values in the in‑memory JSON objects (§7.2). All subsequent steps operate on normalised data.
2. **Canonical serialisation** – serialise `businessData` and all view objects to canonical JSON (§7.1).
3. **Media whitelist construction** – determine the set of media files actually referenced by the business data and views. This is performed by traversing the in‑memory JSON objects:

   ```
   Procedure COLLECT_MEDIA_REFS(value, output_set):
     if value is a string:
       if the string matches the pattern /^media:\/\/([a-zA-Z0-9_\-.\/]+)$/,
         extract the path (the part after media://) and add it to output_set.
     else if value is an array:
       for each item in the array, call COLLECT_MEDIA_REFS(item, output_set).
     else if value is a non‑null object:
       for each property value of the object, call COLLECT_MEDIA_REFS(value, output_set).
     (other types are ignored)
   ```

   Additionally, for each extension directory, if a `media-references.json` file is present (see §8.1.1), its paths are added to the whitelist. The caller may supply extra paths via the `extraReferences` option.

4. **Orphaned asset removal** – prune any file under `media/` that is not in the whitelist.
5. **Per‑file hash** – compute the SHA‑256 hash of each canonical text file **other than `manifest.json`** and each raw media file. `manifest.json` is not hashed in this step; its integrity is covered by the self‑hash mechanism in steps 6–7.
6. **Manifest assembly** – populate `integrity.files` with the hashes computed in step 5. Set `integrity.hash = ""`.
7. **Manifest self‑hash** – NFC‑normalise the manifest object, serialise it canonically, compute its SHA‑256 hash, then set `integrity.hash` to that hex digest. Re‑serialise to produce the final manifest bytes.
8. **ZIP assembly** – create a ZIP archive with UTF‑8 EFS filenames containing all finalised files. Compression is optional (default Deflate level 6).
9. Return the archive as a binary blob.

**Compression options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `compress` | boolean | `true` | Whether to apply Deflate compression to ZIP entries. |
| `compressionLevel` | integer | `6` | Compression level (0‑9). |
| `includeIntegrity` | boolean | `true` | Whether to compute and store the integrity block. |
| `customManifestFields` | object | `{}` | Additional key‑value pairs to merge into `manifest.custom`. |
| `extraReferences` | array of strings | `[]` | Additional media paths (relative to `media/`) that must survive pruning. |

#### 8.1.1 `media-references.json` Schema

Each extension that references bundle media **must** include a `media-references.json` file. The file is a JSON array of path strings relative to `media/`, **without** the `media://` prefix:

```json
["branding/logo.png", "team/alex-avatar.jpg"]
```

- Absent file → treated as an empty list (no extra references).
- Invalid format (non‑array, or array containing non‑string elements) → error code `INVALID_EXTENSION`.

### 8.2 Decompression (`decompressOBB`)

1. **Async unzip** – extract the ZIP contents asynchronously, with lazy extraction for media files when the archive exceeds the configured threshold.
2. **Path security check** – reject any ZIP entry whose NFC‑normalised path contains `..`, `\x00`, or `%00` → `PATH_TRAVERSAL`.
3. **Integrity validation** (if both `integrity.hash` and `integrity.files` are present):
   a. For each file listed in `integrity.files`, recompute its hash and compare. Mismatch → `INTEGRITY_ERROR`.
   b. Any file present in the ZIP **except `manifest.json`** that is absent from `integrity.files` → `INTEGRITY_ERROR`.
   c. Recompute the manifest self‑hash (canonical NFC‑normalised manifest with `integrity.hash = ""`) and compare with the stored `integrity.hash`. Mismatch → `INTEGRITY_ERROR`.
4. If integrity fields are absent, skip step 3 and emit a warning.
5. Build the media ledger as described in §6.2.1, with the disposed flag set to `false`.
6. Return the decoded package.

---

## 9. Processing Engine API

The bundle decoder exposes the following methods on the `DecodedBusinessPackage` object:

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `getMedia` | `path: string` | `Promise<Uint8Array>` | Returns the raw bytes of the media file at the given path. Extraction may be lazy. |
| `getMediaURL` | `path: string` | `Promise<string>` | Increments the reference count for `path` and returns an active Blob URL (browser) or file‑system path (server). Rejects with `LEDGER_DISPOSED` if the ledger has been shut down. |
| `releaseMediaURL` | `path: string`, `url: string` | `void` | Decrements the reference count for the specific URL. When the count reaches zero, the URL is revoked and the entry removed. Safe to call after `cleanup()`. |
| `totalRefCount` | *none* | `number` | Returns the sum of all reference counts currently held in the ledger. |
| `isDisposed` | *none* | `boolean` | Returns `true` if `cleanup()` has been called and the ledger is in soft‑drain mode. |
| `cleanup` | *none* | `void` | Initiates a soft‑drain shutdown: marks the ledger disposed, immediately revokes any URLs with zero references, and returns. Remaining URLs are revoked as `releaseMediaURL` is called. Safe to call at any time. |

---

## 10. Validation & Error Handling

### 10.1 Error Code Catalog

| Code | Trigger |
|------|---------|
| `INVALID_FORMAT` | Not a valid ZIP, or `manifest.json` / `business.json` missing or unparseable. |
| `SCHEMA_VERSION_MISMATCH` | `manifest.schemaVersion` is incompatible with the implementation's supported range. |
| `INTEGRITY_ERROR` | Hash mismatch, unlisted file, or manifest self‑hash mismatch. |
| `PATH_TRAVERSAL` | ZIP entry path contains `..`, `\x00`, or `%00`. |
| `MISSING_REQUIRED_FIELD` | A mandatory field is absent from `manifest.json` or `business.json`. |
| `UNKNOWN_MEDIA_PATH` | A `media://` reference resolves to no file in the bundle. |
| `INVALID_MEDIA_PATH` | A media path contains invalid characters or forbidden segments. |
| `INVALID_EXTENSION` | An extension's `media-references.json` is malformed. |
| `LEDGER_DISPOSED` | `getMediaURL` was called after `cleanup()` has been invoked. |

### 10.2 Security Checks
Path validation also rejects URL‑encoded null bytes (`%00`) and absolute paths. All paths are NFC‑normalised before comparison to prevent homoglyph attacks.

---

## 11. Security

- SVG files are served as Blob URLs and displayed via `<img>` tags, preventing script execution. Implementations that inline SVG into the DOM must sanitise it first.
- Tamper detection is guaranteed by the hash chain: per‑file hashes → stored in manifest → manifest self‑hash protects the entire manifest including the file hash table.
- The `generator` field in the manifest is purely informational and must not influence trust or execution decisions.

---

## 12. Extensibility

- `business.json` may include an `extensions` object for vendor‑specific data.
- `manifest.custom` provides a freeform metadata space for applications.
- Extensions that reference bundle media must include a `media-references.json` file (§8.1.1) to protect their assets from pruning during re‑pack.

---

## 13. Migration

Migration pipelines are keyed on `manifest.schemaVersion`. When an implementation encounters a bundle with an unsupported `schemaVersion`, it consults a migration registry. Migrations are applied sequentially until the target version is reached. If no migration path exists, the bundle is rejected with `SCHEMA_VERSION_MISMATCH`.
`formatVersion` evolves independently and governs the physical container structure.

---

## 14. Testing & Compliance

A comprehensive conformance test suite must verify:

- Cross‑platform hash stability (Node.js vs browser, different ZIP libraries).
- NFC normalisation: identical business data with NFD vs NFC strings yields identical file hashes.
- ZIP filename NFC handling (macOS vs Linux filesystem differences).
- In‑memory media scanning: deeply nested `media://` references are correctly identified.
- Asset update without broken images (soft‑deprecation with multi‑generation URLs).
- Multi‑generation reference counting and correct revocation of old URLs.
- Detection of unlisted files → `INTEGRITY_ERROR`.
- Path traversal attacks → `PATH_TRAVERSAL`.
- Disposed ledger drain: `cleanup()` called while URLs are active, then drained by `releaseMediaURL`.
- Null‑byte injection rejection.
- EFS bit fallback (Central Directory only).
- Pruning of unused media during re‑pack.

---

## 15. Glossary

| Term | Definition |
|------|-----------|
| **Canonical JSON** | JSON serialised with sorted keys and no insignificant whitespace, encoded as UTF‑8. |
| **EFS bit** | Bit 11 of the ZIP general purpose bit flags; signals UTF‑8 filename encoding. |
| **Generation** | A monotonically increasing counter on a raw data entry, incremented each time the asset bytes are replaced. |
| **Manifest self‑hash** | SHA‑256 of the canonical, NFC‑normalised manifest JSON with `integrity.hash` set to `""`. |
| **NFC** | Unicode Normalization Form C; the canonical composed form. |
| **Orphaned asset** | A file under `media/` with no reference in the business data, views, or extension declarations. Removed during compression. |
| **Soft‑drain** | The cleanup pattern that marks the ledger disposed, revokes zero‑reference URLs immediately, and lets remaining URLs drain naturally. |
| **Stale URL** | A Blob URL whose `generation` is no longer current; remains valid and displayable until its reference count reaches zero. |
| **ULID** | Universally Unique Lexicographically Sortable Identifier; a 26‑character Crockford Base32 string. |

---

## 16. Changelog

### v0.1.0 (2026‑06‑14) — Initial public release

- First public version of the Open Business Bundle specification.
- Defines the physical container format (ZIP), allowed paths, and the `.obbiz` extension.
- Introduces the deterministic integrity model (per‑file hashes + manifest self‑hash).
- Establishes the media lifecycle with soft‑deprecation and multi‑generation reference counting.
- Specifies the view configuration layer as purely declarative, with no conditional logic.
- Includes the core business data schema, media URI protocol, and RFC 9535 JSONPath hints.
