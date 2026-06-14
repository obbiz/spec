# Open Business Bundle Format Specification v0.1.0

*Definitive Technical Standard – Production‑Ready*  
*Version 0.1.0 — Last Updated: 2026‑06‑14*  

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

## 2. Physical Bundle Structure

### 2.1 Container
An OBB file is a ZIP archive (Deflate compression, optionally uncompressed) with the custom extension `.obbiz` or `.biz`.  
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

### 3.3 Integrity Model (Deterministic) — **Corrected**

The ZIP wrapper is **not hashed**. Instead, individual file contents are hashed, and the manifest carries a self‑hash.

1. Every file **other than `manifest.json`** inside the bundle is hashed individually after NFC normalisation and canonical serialisation (§7). Per‑file hashes are stored in `manifest.integrity.files`.  
2. The manifest self‑hash is computed as:  
   a. Ensure the key `integrity.hash` is **present** with its value set to `""` (do not remove the key).  
   b. Apply NFC normalisation to all string values in the manifest object (§7.2).  
   c. Serialise using canonical JSON (`fast-json-stable-stringify`).  
   d. Hash the resulting UTF‑8 bytes with SHA‑256.  
   e. Set `integrity.hash` to that hex digest; re‑serialise to produce the final manifest bytes.  

**Validation order:**  
1. For each file listed in `integrity.files`, compute its hash and compare. Mismatch → `INTEGRITY_ERROR`.  
2. Any file present in the ZIP **except `manifest.json`** that is absent from `integrity.files` → `INTEGRITY_ERROR`. `manifest.json` is excluded because its integrity is guaranteed by `integrity.hash` rather than an entry in `integrity.files`.  
3. Recompute the manifest self‑hash as described and compare with `integrity.hash`. Mismatch → `INTEGRITY_ERROR`.

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
Array of items: `id`, `title`, `description`, optional `icon` (`media://...`), `metrics`.

#### 4.2.6 Management Team
`founders`, `advisors`, `boardMembers` arrays. Each member: `id`, `name`, `role`, `bio`, `imageSrc` (`media://...`).

#### 4.2.7 Products & Services
Array of offerings: `name`, `description`, `pricingModel`, `stage`, `screenshots` (array of `media://` URIs), `features`.

#### 4.2.8 Market Analysis
`targetMarket`, `competitors`, `swot`, `marketSize`.

#### 4.2.9 Marketing Strategy
`channels`, `contentPlan`, `cacEstimate`.

#### 4.2.10 Operations
`teamSize`, `techStack`, `ipPatents`, `compliance`.

#### 4.2.11 Roadmap
`milestones`: `date`, `title`, `status` (`planned`, `in‑progress`, `completed`).

#### 4.2.12 Financial Statements
Income statement, balance sheet, cash flow, forecasts. All monetary values in `global.currency`.

#### 4.2.13 Funding Requirements
`amountNeeded`, `useOfFunds`, `offeringStructure`.

#### 4.2.14 Risk Analysis
`risks`: `type`, `likelihood` (1‑5), `impact` (1‑5), `mitigation`.

#### 4.2.15 Appendices
Array of supporting documents (`media://` links).

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

- `contentOrder` – ordered list of section keys.
- `sections` – optional per‑section styling overrides.
- `references.dataPaths` – **RFC 9535 JSONPath expressions** relative to the root of `business.json`. The `$` root is implied; paths must not start with `$`. Only normalised paths and the wildcard `[*]` are used; filter expressions are unsupported and ignored.

## 6. Media Handling Pipeline

### 6.1 Media URI Specification
Format: `media://<path>` where `<path>` is relative to `media/`, using forward slashes, no `..`, no null bytes. Case‑sensitive.

### 6.2 Media Lifecycle Management (Soft‑Deprecation with Multi‑Generation Ref Counting)

#### 6.2.1 Ledger Structure
```typescript
interface RefEntry {
  url: string;           // Blob URL
  refCount: number;
  mimeType: string;
  generation: number;    // rawData generation this URL represents
  stale: boolean;        // true if a newer generation exists
}

interface MediaLedger {
  // Key: media path relative to media/ (e.g. "team/alex-avatar.jpg")
  rawData: Map<string, { data: Uint8Array; generation: number }>;

  // One path → list of live RefEntry objects (potentially multiple generations)
  activeRefs: Map<string, RefEntry[]>;

  disposed: boolean;  // true after cleanup()
}
```

#### 6.2.2 `getMediaURL(path)`
1. If `disposed === true`, reject with `LEDGER_DISPOSED`.
2. Retrieve `entries = activeRefs.get(path) ?? []`.
3. Find first non‑stale entry; if found, increment its `refCount` and return its `url`.
4. Look up `rawData.get(path)`. If absent → `UNKNOWN_MEDIA_PATH`.
5. Create a new Blob URL from `rawData.get(path).data`.
6. Append a new `RefEntry` with `refCount = 1`, `generation` from rawData, `stale = false`. Store back into `activeRefs`.
7. Return the new URL.

#### 6.2.3 Asset Update
When an asset is replaced:
1. Increment `rawData.get(path).generation` and update `.data`.
2. Mark **all** existing `RefEntry` items for that path as `stale = true`.
3. **Do not forcibly revoke** old URLs. Components currently using the old URL continue to display it.
4. Subsequent `getMediaURL` calls will see no non‑stale entry and create a fresh URL for the new data. Stale entries drain naturally when their holders release them.

#### 6.2.4 `releaseMediaURL(path, url)`
1. Retrieve `entries = activeRefs.get(path)`. If absent, no‑op.
2. Find the entry where `entry.url === url`.
3. Decrement `entry.refCount`.
4. If `refCount === 0`: `URL.revokeObjectURL(url)`, remove entry from array.
5. If array is now empty, delete the path key from `activeRefs`.

#### 6.2.5 `cleanup()` – Soft‑Drain Shutdown
1. Set `disposed = true`. All future `getMediaURL` calls are rejected.
2. Iterate all `entries`. For any with `refCount === 0`: revoke URL and remove entry.
3. Return immediately. Do **not** block on entries with `refCount > 0`.

Remaining Blob URLs will be revoked automatically as components unmount and call `releaseMediaURL`. This pattern is safe to call at any time, even with active URLs.

## 7. Serialization & Determinism

### 7.1 Canonical JSON
All text files (`manifest.json`, `business.json`, `views/*.json`) must be serialised with canonical JSON:
- Object keys sorted lexicographically (Unicode code point order).
- No insignificant whitespace.
- UTF‑8 encoding.
Use `fast-json-stable-stringify`.

### 7.2 Unicode Normalisation (NFC)
Before any text file is serialised, **all string values** within the JSON object graph must be normalised to **Unicode Normalization Form C (NFC)**. This applies recursively to all property values. Property **names** in OBB‑defined schemas are restricted to ASCII, but extension data (e.g., inside `manifest.custom` or `business.json`'s `extensions` block) may contain non‑ASCII keys; implementers should normalise such keys to NFC for consistency, though OBB processors are not required to validate this.

```typescript
function normalizeNFC(value: unknown): unknown {
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) return value.map(normalizeNFC);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => [k, normalizeNFC(v)])
    );
  }
  return value;
}
```

## 8. Compression & Packaging Algorithm

### 8.1 Building a Bundle (`compressOBB`) — **Corrected**

1. **NFC normalisation** of all JSON objects (§7.2).
2. **Canonical serialisation** of `businessData` and all views.
3. **Media whitelist construction** – must use **in‑memory object graph traversal**, not regex, to avoid issues with serialiser escape behaviour:
   ```typescript
   function collectMediaRefs(value: unknown, refs: Set<string>): void {
     if (typeof value === 'string') {
       const m = /^media:\/\/([a-zA-Z0-9_\-.\/]+)$/.exec(value);
       if (m) refs.add(m[1]);
     } else if (Array.isArray(value)) {
       for (const item of value) collectMediaRefs(item, refs);
     } else if (value !== null && typeof value === 'object') {
       for (const v of Object.values(value as Record<string, unknown>))
         collectMediaRefs(v, refs);
     }
   }
   ```
   Also scan:
   - Each extension directory's `media-references.json` (see §8.1.1).
   - Paths supplied via `opts.extraReferences`.
4. **Orphaned asset removal** – prune any `media/` file not in the whitelist.
5. **Per‑file hash** – compute the SHA‑256 hash of each canonical text file **other than `manifest.json`** and each raw media file. `manifest.json` is not hashed in this step; its integrity is covered by the self‑hash mechanism in steps 6–7.
6. **Manifest assembly** – populate `integrity.files` with the hashes computed in step 5. Set `integrity.hash = ""`.
7. **Manifest self‑hash** – NFC‑normalise the manifest object, serialise, hash, set `integrity.hash`.
8. **ZIP assembly** – create archive with UTF‑8 EFS filenames. Compression optional (default level 6).
9. Return blob.

**Options:**
```typescript
interface CompressOptions {
  compress?: boolean;
  compressionLevel?: number;     // 0‑9, default 6
  includeIntegrity?: boolean;    // default true
  customManifestFields?: Record<string, unknown>;
  extraReferences?: string[];    // extra media paths to preserve
}
```

#### 8.1.1 `media-references.json` Schema
Each extension that references bundle media **must** include a `media-references.json` file, a JSON array of path strings relative to `media/`, without the `media://` prefix:
```json
["branding/logo.png", "team/alex-avatar.jpg"]
```
- Absent file → treated as empty list.
- Invalid format (non‑array, non‑string elements) → `INVALID_EXTENSION`.

### 8.2 Decompression (`decompressOBB`) — **Corrected**

1. Async unzip with lazy media extraction.
2. **Path security check** – reject any entry whose NFC‑normalised path contains `..`, `\x00`, or `%00` → `PATH_TRAVERSAL`.
3. **Integrity validation** (if `integrity` fields present):
   a. For each file in `integrity.files`, recompute hash and compare.
   b. Any file present in the ZIP **except `manifest.json`** that is absent from `integrity.files` → `INTEGRITY_ERROR`.
   c. Recompute manifest self‑hash and compare with `integrity.hash`.
4. If integrity fields are absent, skip step 3 and warn.
5. Build media ledger, set `disposed = false`.
6. Return `DecodedBusinessPackage`.

## 9. Processing Engine API

```typescript
interface DecodedBusinessPackage {
  manifest: Manifest;
  businessData: BusinessData;
  views: Record<string, unknown>;

  getMedia(path: string): Promise<Uint8Array>;

  /** Increments ref‑count and returns a Blob URL. Rejects if disposed. */
  getMediaURL(path: string): Promise<string>;

  /** Decrements ref‑count for the specific URL. Safe to call after cleanup(). */
  releaseMediaURL(path: string, url: string): void;

  /** Returns sum of all active refCounts (observability). */
  totalRefCount(): number;

  /** Returns true after cleanup() has been called. */
  isDisposed(): boolean;

  /**
   * Soft‑drain cleanup. Immediately revokes zero‑ref URLs, marks disposed,
   * and returns. Remaining URLs are revoked as releaseMediaURL drains them.
   * Safe to call at any time, even with active refs.
   */
  cleanup(): void;
}
```

## 10. Validation & Error Handling

### 10.1 Error Code Catalog

| Code | Trigger |
|------|---------|
| `INVALID_FORMAT` | Not a valid ZIP, or `manifest.json`/`business.json` missing/unparseable. |
| `SCHEMA_VERSION_MISMATCH` | `manifest.schemaVersion` incompatible with implementation. |
| `INTEGRITY_ERROR` | Hash mismatch, unlisted file, or manifest self‑hash mismatch. |
| `PATH_TRAVERSAL` | ZIP entry path contains `..`, `\x00`, or `%00`. |
| `MISSING_REQUIRED_FIELD` | A mandatory field is absent. |
| `UNKNOWN_MEDIA_PATH` | `media://` reference not found in bundle. |
| `INVALID_MEDIA_PATH` | Media path contains invalid characters or segments. |
| `INVALID_EXTENSION` | `media-references.json` is malformed. |
| `LEDGER_DISPOSED` | `getMediaURL` called after `cleanup()`. |

### 10.2 Security Checks
Path validation also rejects URL‑encoded null bytes (`%00`) and absolute paths. All paths are NFC‑normalised before comparison.

## 11. Security
- SVGs are served as blob URLs and displayed via `<img>`; inline SVG must be sanitised.
- Tamper detection via the hash chain: per‑file hashes → manifest → manifest self‑hash.
- The `generator` field is purely informational.

## 12. Extensibility
- `business.json` may include an `extensions` object.
- `manifest.custom` for application metadata.
- Extensions must declare media dependencies in `media-references.json` to protect against pruning.

## 13. Migration
Migration pipelines are keyed on `manifest.schemaVersion`. `formatVersion` evolves independently. Implementations apply sequential upgrades.

## 14. Testing & Compliance

A comprehensive test suite must verify:
- Cross‑platform hash stability (Node.js vs browser, different ZIP libs).
- NFC normalisation: identical business data with NFD vs NFC strings yields identical hashes.
- ZIP filename NFC handling (macOS vs Linux).
- In‑memory media scan: deeply nested `media://` references are correctly found.
- Asset update without broken images (soft‑deprecation).
- Multi‑generation ref counting and correct revocation.
- Detection of unlisted files → `INTEGRITY_ERROR`.
- Path traversal attacks → `PATH_TRAVERSAL`.
- Disposed ledger drain: `cleanup()` called while URLs active, then drained by `releaseMediaURL`.
- Null‑byte injection rejection.
- EFS fallback (Central Directory only).
- Pruning of unused media on re‑pack.

## 15. Glossary

| Term | Definition |
|------|-----------|
| **Canonical JSON** | JSON serialised with sorted keys, no whitespace, UTF‑8. |
| **EFS bit** | Bit 11 of ZIP general purpose flags; signals UTF‑8 encoding. |
| **Generation** | Monotonically increasing number on `rawData` for an asset. |
| **Manifest self‑hash** | SHA‑256 of the canonical, NFC‑normalised manifest with `integrity.hash=""`. |
| **NFC** | Unicode Normalization Form C (composed). |
| **Orphaned asset** | A `media/` file with no reference; removed during compression. |
| **Soft‑drain** | Cleanup pattern: mark disposed, revoke zero‑ref URLs, let remaining URLs drain naturally. |
| **Stale URL** | A Blob URL whose generation is no longer current; still valid until refCount=0. |
| **ULID** | 26‑character Crockford Base32 unique sortable identifier. |

## 16. Changelog (v0.1.0)

| # | Area | Change |
|---|------|--------|
| – | §3.3, §8.1, §8.2 | **Critical fix:** `manifest.json` is explicitly excluded from the per‑file hash list (`integrity.files`) and from the unlisted‑file integrity check. It is covered exclusively by the manifest self‑hash. |
| – | §4.2 | Clarified that prose descriptions are informative; the normative JSON Schema is a separate, version‑matched document. |
| – | §7.2 | Added note about NFC normalisation of non‑ASCII keys in extension data. |
| + all | – | All previous 0.1.0 improvements retained (soft‑drain cleanup, NFC normalisation, multi‑generation ref counting, in‑memory media scan, etc.). |
