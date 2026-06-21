# Open Business Bundle Format Specification v0.1.0

*Definitive Technical Standard – Production‑Ready*  
*Version 0.1.0*

---

## 1. Introduction

### 1.1 Purpose
The Open Business Bundle (OBB) is a self‑contained, portable file format for representing business entities, their media assets, and presentation views in a single, deterministic, tamper-proof archive. It supports optional at-rest encryption, enabling secure transport of sensitive business data across any platform without external dependencies.

### 1.2 Goals & Non‑Goals
* **Goals:** Single source of truth (JSON), multi-view decoupling, deterministic integrity, strict security (DoS protection, SVG sanitization), and optional AES-256-GCM at-rest encryption.
* **Non‑Goals:** Real‑time collaboration (OBB is a static snapshot; live editing requires an external database workspace), public-key cryptography, multi-language data within a single bundle.

---

## 2. Physical Bundle Structure

### 2.1 Container & Identification
An OBB file is a ZIP archive with the extension `.obbiz`. 
**MIME type:** `application/vnd.open-business-bundle+zip`

**Magic Bytes & Archive Comment:** 
To prevent MIME sniffing, the ZIP archive **MUST** contain the exact ASCII string `OBB-V1` in the ZIP file comment field. Implementations **MUST** verify this comment before attempting deep parsing.

**ZIP filename encoding:** 
All entry filenames **MUST** be encoded as UTF‑8. The EFS bit (bit 11) in the **Central Directory** is authoritative. If the Central Directory is missing, corrupt, or the EFS bit is not set, the bundle **MUST** be rejected (`INVALID_FORMAT`). 

### 2.2 Directory Layout
```text
company-workspace.obbiz
├── manifest.json          # Plaintext, contains encryption parameters & hashes
├── business.json          # Encrypted if encryption is enabled
├── media/                 # Encrypted if encryption is enabled
├── views/                 # Encrypted if encryption is enabled
└── extensions/            # Encrypted if encryption is enabled
```

### 2.3 Path Security Rules
Path traversal checks **MUST** operate on *path segments*. 
1. Split the path by `/`. 
2. Reject if any segment is exactly `..` or empty.
3. Reject if any segment contains characters outside `[a-zA-Z0-9_\-\.]`.
4. Null bytes (`\x00`, `%00`) and absolute paths are strictly forbidden.
Violations **MUST** be rejected with `PATH_TRAVERSAL`.

### 2.4 Decompression Limits (DoS Protection)
Implementations **MUST** enforce the following limits during decompression to prevent Zip Bombs and parser exhaustion:
* **Max Uncompressed Size:** 100 MB total across all entries. Violation -> `SIZE_LIMIT_EXCEEDED`.
* **Max Compression Ratio:** 100:1 per entry. Violation -> `SIZE_LIMIT_EXCEEDED`.
* **Max Nesting Depth:** JSON parsers **MUST** reject objects/arrays nested deeper than 64 levels. Violation -> `NESTING_LIMIT_EXCEEDED`.

---

## 3. Core Metadata Layer (`manifest.json`)

The manifest is **always plaintext** so that applications can read metadata, verify structure, and prompt for passwords without requiring the decryption key.

### 3.1 Schema
```json
{
  "fileFormat": "open-business-bundle",
  "formatVersion": "0.1.0",
  "schemaVersion": "0.1.0",
  "projectId": "urn:obb:project:01J3Z8VTYKABCDEF01234567AB",
  "createdAt": "2024-03-15T08:00:00Z",
  "updatedAt": "2024-10-25T09:00:00Z",
  "generator": { "name": "example-generator", "version": "1.0.0" },
  "locales": ["en"],
  "encryption": {
    "algorithm": "aes-256-gcm",
    "kdf": "argon2id",
    "kdfParams": {
      "salt": "base64encodedSalt",
      "iterations": 10,
      "memoryKiB": 131072,
      "parallelism": 4
    }
  },
  "integrity": {
    "algorithm": "sha256",
    "hash": "9f86d081...",
    "files": {
      "business.json": "e3b0c44...",
      "media/branding/logo.png": "1d0258c..."
    }
  },
  "custom": {}
}
```

### 3.2 Field Reference
* `encryption` (object, optional): If present, all files except `manifest.json` are encrypted.
  * `algorithm`: Cipher used. **MUST** be `aes-256-gcm`.
  * `kdf`: Key Derivation Function. **MUST** be `argon2id` (RFC 9106).
  * `kdfParams`: Parameters for Argon2id. To resist offline brute-force attacks, implementations **MUST** enforce minimums of `iterations: 10`, `memoryKiB: 131072` (128 MiB), and `parallelism: 4`.
* `integrity`: Contains `algorithm` ("sha256"), `hash` (manifest self-hash), and `files` (map of path -> hex SHA-256).

### 3.3 Integrity Model (Deterministic & Encrypted)
To maintain cross-platform determinism, **hashes are computed on the *unencrypted, plaintext* data.** 

1. **Text Files (`.json`):** Hashed based on their exact bytes, generated via RFC 8785 Canonical JSON and NFC normalization.
2. **Binary Files (media):** Hashed exactly as they are byte-for-byte.
3. **Manifest Self-Hash Computation:**
   a. Set `integrity.hash` to `""`.
   b. Apply NFC normalisation to all string values and keys.
   c. Serialise using RFC 8785 Canonical JSON.
   d. Hash the UTF‑8 bytes with SHA‑256.
   e. Set `integrity.hash` to the hex digest; re‑serialise.

**Validation & Decryption Order:**
1. Recompute manifest self-hash. Mismatch -> `INTEGRITY_ERROR`.
2. If `encryption` is present, derive key from user passphrase using `argon2id`. 
3. **Password Verification:** Decrypt the smallest file in the bundle (usually `business.json`). If the AES-GCM Auth Tag verification fails, the passphrase is wrong -> `INVALID_PASSWORD`. *(Note: Relying on GCM Auth Tag failure eliminates offline brute-force vectors and timing side-channels introduced by explicit check hashes).*
4. For each file in `integrity.files`: Decrypt the file (if not already decrypted), recompute SHA-256 of the plaintext, and compare. Mismatch -> `INTEGRITY_ERROR`.
5. Any file in the ZIP (except `manifest.json`) absent from `integrity.files` -> `INTEGRITY_ERROR`.

---

## 4. Business Data Schema (`business.json`)

### 4.1 Design Principles
* **Style‑free:** No layout, fonts, or colours.
* All media references use `media://<path>` relative to `media/`.
* Extensible via an `extensions` object.

### 4.2 Core Schema (v0.1.0)
*Note: The full logical structure is defined by an accompanying machine‑readable JSON Schema document.*

All fields representing monetary values (e.g., `revenue`, `amountNeeded`, `shares`) **MUST** be expressed as integers representing the smallest unit of the currency defined in `global.currency` (e.g., cents for USD). Floating-point numbers and decimal strings are **strictly forbidden** for monetary fields to prevent precision loss. Percentages and rates **MUST** be expressed as decimal strings (e.g., `"0.015"` for 1.5%).

#### 4.2.1 Global Settings
```json
{ "currency": "USD", "baseLanguage": "en", "timezone": "America/Chicago", "measurementSystem": "metric" }
```

#### 4.2.2 Identity
```json
{
  "companyName": "SaaSOptimize",
  "tagline": "AI-Driven Operational Cloud Cost Infrastructure Metrics Extraction Layer",
  "logo": "media://branding/logo.png",
  "website": "https://saasoptimize.com",
  "socialProfiles": {
    "linkedin": "https://linkedin.com/company/saasoptimize",
    "twitter": "@saasoptimize"
  },
  "contact": {
    "primaryName": "Jane Doe",
    "primaryRole": "CEO",
    "email": "jane@saasoptimize.com",
    "phone": "+1-555-019-8372"
  }
}
```

#### 4.2.3 Legal Profile
```json
{
  "legalName": "SaaSOptimize Technologies Inc.",
  "entityType": "C-Corporation",
  "jurisdiction": "Delaware, USA",
  "dateFounded": "2024-01-10",
  "taxId": "XX-XXXXXXX",
  "address": { "street": "...", "city": "...", "postalCode": "...", "country": "US" },
  "disclaimers": {
    "forwardLookingStatements": "This document contains forward-looking statements based on current expectations...",
    "confidentiality": "This document is confidential and intended solely for the recipient..."
  }
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
Contains `milestones`, an array of objects with: `id`, `date`, `title`, `status` (`planned`, `in-progress`, or `completed`).

#### 4.2.12 Financial Statements
Income statement, balance sheet, cash flow, and forecasts. All monetary values expressed as integers in minor units.

#### 4.2.13 Traction & Metrics
```json
"traction": {
  "currentMetrics": {
    "mrr": 5400000,
    "activeUsers": 14200,
    "churnRate": "0.015"
  },
  "historicalData": [
    { "date": "2024-08-31", "metric": "mrr", "value": 5100000 },
    { "date": "2024-09-30", "metric": "mrr", "value": 5400000 }
  ],
  "highlights": ["Hit $5M ARR in Q3", "Acquired EnterpriseCo as design partner"]
}
```

#### 4.2.14 Cap Table
```json
"capTable": {
  "totalAuthorizedShares": 10000000,
  "stakeholders": [
    {
      "name": "Alex Founder",
      "type": "founder",
      "shares": 3500000,
      "percentage": "35.0",
      "vestingSchedule": "4yr / 1yr cliff"
    },
    {
      "name": "Seed Ventures",
      "type": "investor",
      "shares": 1500000,
      "percentage": "15.0",
      "instrument": "Preferred Stock"
    }
  ],
  "employeeOptionPool": 1000000
}
```

#### 4.2.15 Funding Requirements
Contains: `amountNeeded` (integer, minor units), `useOfFunds`, `offeringStructure`.

#### 4.2.16 Risk Analysis
Contains `risks`, an array of objects with: `type`, `likelihood` (1-5 integer), `impact` (1-5 integer), `mitigation`.

#### 4.2.17 Appendices
Array of supporting documents, each referenced by a `media://` link.

---

## 5. View Configuration Layer

### 5.1 Overview
Views are purely declarative layout configurations. No conditional logic or expression evaluation is defined.

### 5.2 View Structure
```json
{
  "viewType": "business-plan",
  "settings": { "paperSize": "a4" },
  "contentOrder": ["identity", "executiveSummary", "traction"],
  "references": {
    "dataPaths": ["identity.logo", "managementTeam.founders[*].imageSrc"]
  }
}
```
* `references.dataPaths`: RFC 9535 JSONPath expressions. The `$` root is implied.
* **Strict Restriction:** Only normalized paths and the wildcard `[*]` are permitted. Filter expressions (e.g., `[?(@.role == 'CEO')]`) are **strictly forbidden**. Violations **MUST** be rejected with `INVALID_VIEW_CONFIG`.

---

## 6. Media Handling API Contract

How a platform manages memory is an implementation detail. A compliant decoder **MUST** expose the following API. If the bundle is encrypted, the implementation **MUST** handle decryption transparently before returning the data.

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `getMedia` | `path: string` | `Promise<Uint8Array>` | Returns raw, decrypted bytes. |
| `getMediaURL` | `path: string` | `Promise<string>` | Returns a platform reference (Blob URL, file path). |
| `releaseMediaURL`| `path, url` | `void` | Frees underlying resources. |
| `cleanup` | *none* | `void` | Gracefully shuts down media resources. |

*(See Appendix A for a recommended reference-counting implementation strategy).*

---

## 7. Serialization & Determinism

### 7.1 Canonical JSON (RFC 8785)
All text files **MUST** be serialised using **RFC 8785 (JSON Canonicalization Scheme)**. This mandates lexicographic key sorting, no insignificant whitespace, and strict shortest round-trip number representation. Files **MUST NOT** have a Byte Order Mark (BOM).

### 7.2 Unicode Normalisation (NFC)
Before any *text file* is serialised, **all string values and all object keys** within the JSON graph **MUST** be normalised to **Unicode Normalization Form C (NFC)**. This applies recursively to extension data. 

**Critical:** NFC normalization **MUST NOT** be applied to binary media files.

---

## 8. Compression & Encryption Pipeline

### 8.1 Building a Bundle (`compressOBB`)

1. **NFC normalisation:** Apply NFC to all JSON strings and keys. **Do not touch binary media.**
2. **Canonical serialisation:** Serialise JSON objects using RFC 8785.
3. **Media whitelist construction:** Traverse JSON to find `media://` references. Validate paths per §2.3.
4. **Orphaned asset handling:** By default, do **not** prune unreferenced media. Only prune if `pruneOrphans: true` is explicitly passed.
5. **Magic Byte Validation:** Validate file signatures of media files upon inclusion. Mismatch -> `INVALID_MEDIA_PATH`.
6. **Security Sanitization (SVG):** `.svg` files **MUST** be sanitized to strip `<script>` tags, event handlers, and external entities.
7. **Per‑file hash (Plaintext):** Compute SHA‑256 of each canonical text file (except `manifest.json`) and raw media file. This establishes the `integrity.files` map.
8. **Encryption (If enabled):**
   a. Generate a cryptographically random 32-byte salt.
   b. Derive a 256-bit master key from the user's passphrase using Argon2id (`iterations: 10`, `memory: 128MiB`, `parallelism: 4`).
   c. For **each file** (except `manifest.json`), generate a random 12-byte AES-GCM nonce using a **Cryptographically Secure Pseudorandom Number Generator (CSPRNG)**.
   d. **CRITICAL SECURITY WARNING:** Nonce reuse with the same key destroys the confidentiality and integrity of AES-GCM. Implementations **MUST** guarantee nonce uniqueness within a bundle. Deterministic nonce derivation (e.g., hashing the filename) is forbidden.
   e. Encrypt the file's plaintext bytes.
   f. The final byte payload to be stored in the ZIP is: `[12-byte Nonce] + [Ciphertext] + [16-byte GCM Auth Tag]`.
9. **Manifest assembly & self-hash:** Populate `integrity.files` and `encryption` block. Compute self-hash per §3.3.
10. **ZIP assembly:** Create ZIP with UTF‑8 EFS filenames and the `OBB-V1` archive comment. Deflate level 6 default.

### 8.2 Decompression (`decompressOBB`)

1. **Magic Byte Check:** Verify `OBB-V1` ZIP comment. Verify limits (§2.4).
2. **Path security:** Validate every ZIP entry per §2.3.
3. **Manifest Validation:** Parse `manifest.json`. Recompute manifest self-hash. Mismatch -> `INTEGRITY_ERROR`.
4. **Key Derivation & Password Verification:** If `encryption` is present, prompt for passphrase. Derive key via Argon2id. Attempt decryption of the smallest file to verify the GCM Auth Tag. Failure -> `INVALID_PASSWORD`.
5. **File Validation & Decryption:** For each file in `integrity.files`:
   a. Read the encrypted payload from the ZIP.
   b. Extract the 12-byte nonce, ciphertext, and 16-byte tag.
   c. Decrypt using AES-256-GCM. If the GCM Auth Tag verification fails -> `INTEGRITY_ERROR` (tampered or wrong key).
   d. Compute SHA-256 of the decrypted plaintext. Compare with `integrity.files`. Mismatch -> `INTEGRITY_ERROR`.
6. Return decoded package.

---

## 9. Error Handling & Security

### 9.1 Error Code Catalog

| Code | Trigger |
|------|---------|
| `INVALID_FORMAT` | Not a valid ZIP, missing `OBB-V1` comment, corrupt Central Directory, EFS bit missing, or core JSON unparseable. |
| `SCHEMA_VERSION_MISMATCH` | `schemaVersion` incompatible with implementation. |
| `INTEGRITY_ERROR` | Hash mismatch, unlisted file, manifest self‑hash mismatch, or AES-GCM Auth Tag failure (during file decryption). |
| `INVALID_PASSWORD` | Supplied passphrase fails the GCM Auth Tag verification during the initial password check. |
| `PATH_TRAVERSAL` | ZIP entry path contains `..` segment, null bytes, or invalid characters. |
| `SIZE_LIMIT_EXCEEDED` | Decompression size or compression ratio limits exceeded. |
| `NESTING_LIMIT_EXCEEDED` | JSON parser hit the 64-level nesting depth limit. |
| `INVALID_MEDIA_PATH` | Media path invalid, or file magic bytes do not match extension. |
| `INVALID_VIEW_CONFIG` | View file contains forbidden logic (e.g., JSONPath filters). |

### 9.2 Fuzzing & Conformance Requirement
Conformant implementations **MUST** be fuzz-tested against malformed inputs (corrupt ZIPs, truncated JSON, invalid UTF-8, massive compression ratios, corrupted nonces/tags) to ensure they fail gracefully with the defined error codes rather than crashing the host process.

---

## 10. Appendix A: Media Ledger Implementation Guide (Non-Normative)

While §6 defines the language-agnostic API contract for media handling, platform-specific implementations (especially in browser environments) must carefully manage memory to prevent leaks when dealing with Blob URLs. 

A recommended pattern is a **Reference-Counting Media Ledger**:
* **Multi-Generation Tracking:** When media is updated, increment a `generation` counter. Mark previously issued URLs as `stale`. Do not forcibly revoke stale URLs; allow components currently displaying them to finish.
* **Soft-Drain Cleanup:** When `cleanup()` is called, mark the ledger as `disposed`. Immediately revoke any URLs with a reference count of zero. For URLs with active references, let them drain naturally as components unmount and call `releaseMediaURL`.
* **Disposed State:** If `getMediaURL` is called after `cleanup()`, reject with an implementation-specific error (e.g., `LEDGER_DISPOSED`).

---

## 11. Glossary

| Term | Definition |
|------|-----------|
| **AES-256-GCM** | Advanced Encryption Standard with 256-bit keys in Galois/Counter Mode. Provides authenticated encryption. |
| **Argon2id** | Cryptographic hashing algorithm designed for secure password derivation (RFC 9106). |
| **CSPRNG** | Cryptographically Secure Pseudorandom Number Generator. Required for AES-GCM nonces. |
| **RFC 8785** | JSON Canonicalization Scheme. Ensures deterministic byte output. |
| **EFS bit** | Bit 11 of ZIP flags; signals UTF‑8 filename encoding. |
| **NFC** | Unicode Normalization Form C. Applied to JSON text only. |
| **Path Segment** | A substring of a path delimited by `/`. Used for strict traversal validation. |