# Changelog

All notable changes to the Open Business Bundle Format Specification.

## 2026-06-14 – v0.1.0

- **formatVersion:** `0.1.0`
- **schemaVersion:** `0.1.0`

### Changes
- Initial release of the Open Business Bundle format with:
  - Core metadata layer (`manifest.json`)
  - Business data schema (`business.json`)
  - View configuration layer (`views/*.json`)
  - Media handling pipeline with `media://` protocol
  - Deterministic integrity model (self-hash + per-file hashes)
  - Canonical JSON serialisation with NFC normalisation
  - Soft-drain media lifecycle management
  - Extensibility via `extensions/` namespace and `custom` fields
  - Machine-readable JSON Schemas (Draft 2020-12)
  - Test fixtures and CI validation pipeline
