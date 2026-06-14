# OBB Format Proposals

This directory holds draft proposals for changes and enhancements to the **Open Business Bundle** specification.

## How to propose a change

1. **Open an issue** in the repository with a short title that summarises the idea.
   - Use the label `proposal` so it is easy to discover.
   - Discuss the idea informally in the issue. The core maintainers and community will give early feedback on feasibility, scope, and alignment with the spec's goals.

2. **Draft a proposal document**
   - Fork the repository and create a new directory under `proposals/` named `NNNN-short-title/`.
     - `NNNN` is the GitHub issue number (zero‑padded, e.g. `0012`).
   - Copy `proposals/TEMPLATE.md` into your new directory as `proposal.md` and fill in every section.
   - If the proposal includes sample bundles, schemas, or code, place them inside the same directory.

3. **Submit a Pull Request**
   - Create a PR that adds only your proposal directory.
   - In the PR description, link to the discussion issue.
   - The proposal will enter **formal review**.

## Review stages

| Stage | Meaning |
|-------|---------|
| **Draft** | The proposal is under active discussion. PR is open; changes may be pushed frequently. |
| **Candidate** | The proposal is stable, all objections have been addressed, and the core team believes it is ready for final decision. |
| **Accepted** | The proposal is merged into the repository. It will be included in a future version of the specification. |
| **Rejected** | The proposal is closed. The PR may be merged with a `REJECTED.md` summary for posterity. |
| **Withdrawn** | The author decided to stop working on the proposal. |

## Decision criteria

Before a proposal can move to **Accepted**, the core maintainers will check:

- **Spec alignment** – Does it respect the original goals (§1.2 of `spec.md`)?  
  *No execution logic in views, deterministic integrity, style‑agnostic business data, etc.*
- **Backward compatibility** – Will existing valid bundles remain valid?  
  If not, is the breakage clearly justified and accompanied by a migration path?
- **Implementability** – Can it be implemented in at least two different environments (browser, Node.js, Go, Python)?
- **Security** – Does it introduce new attack surface or weaken path/integrity guarantees?
- **Simplicity** – Is there a simpler way to achieve the same outcome?

## Accepted proposals

Once accepted, the proposal's directory stays in the repository. The specification (`spec.md`) and relevant schemas are updated in a later PR. The `CHANGELOG.md` will reference the proposal for traceability.

## Questions?

Open an issue or comment on an existing proposal. The process is meant to be collaborative, not bureaucratic.
