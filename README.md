# Open Business Bundle (OBB) Format Specification

![Format Version](https://img.shields.io/badge/format-v0.1.0-blue)
![Schema Version](https://img.shields.io/badge/schema-v0.1.0-blue)
![License](https://img.shields.io/badge/license-CC--BY--4.0-lightgrey)

A self-contained, portable file format for representing business entities, their media assets, and presentation views in a single deterministic archive.

## Contents

- **[spec.md](spec.md)** — Full technical specification (v0.1.0)
- **[definitions/v0.1.0/](definitions/v0.1.0/)** — Machine‑readable JSON Schemas for `manifest.json`, `business.json`, and view files
- **[test-fixtures/](test-fixtures/)** — Example `.obbiz` bundles for validation and testing
- **[scripts/](scripts/)** — TypeScript scripts to regenerate test fixtures and validate schemas

## Quick Start for Implementers

1. Read the [specification](spec.md) for the full format definition.
2. Validate your bundles against the [JSON Schemas](definitions/v0.1.0/).
3. Use the [test fixtures](test-fixtures/) to verify your implementation.

### Regenerating Test Fixtures

```bash
cd scripts
npm install
npm run generate
```

The generated `.obbiz` files are committed to the repository so downstream consumers can validate without running the generator.

## License

This specification is licensed under [Creative Commons Attribution 4.0 International](LICENSE).
