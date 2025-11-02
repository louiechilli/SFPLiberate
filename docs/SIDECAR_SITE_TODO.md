# Sidecar Site (GitHub Pages) – TODO

A companion static site hosted on GitHub Pages to provide documentation and a community‑maintained repository of SFP modules.

## Goals

- Public docs (user guide, troubleshooting, BLE protocol notes).
- Community module repository: index + downloadable module blobs.
- Low‑friction contribution path (PRs/issues) with automated validation.

## Tech Choices (proposed)

- Static site generator: MkDocs + Material (simple) or Docusaurus (versioned docs).
- Source: `docs/` directory in a `gh-pages` branch or a separate repo (recommended for clarity, e.g. `SFPLiberate/site`).
- Community modules: separate repo (recommended), e.g. `SFPLiberate/modules` to keep PRs/reviews focused.

## Repository Structure (modules repo)

```
modules/
  index.json                # master index of all modules (see schema below)
  blobs/
    <sha256>.bin           # raw EEPROM blobs (binary)
  meta/
    <id>.json              # optional metadata files (same content as index entry for review)
  CONTRIBUTING.md
  .github/workflows/validate.yml
```

### `index.json` entry schema (draft)

```
{
  "version": 1,
  "modules": [
    {
      "id": "uuid-v4",
      "name": "Cisco 10G CU 1m",
      "vendor": "CISCO-OEM",
      "model": "SFP-H10GB-CU1M",
      "serial": "ABCDEFG12345",
      "sha256": "<hex>",            // of raw .bin
      "size": 256,                   // bytes
      "blob_url": "https://.../blobs/<sha256>.bin",
      "submitted_by": "github-username",
      "created_at": "2025-01-01T00:00:00Z",
      "notes": "optional string"
    }
  ]
}
```

## TODOs

- Site scaffolding
  - [ ] Create `SFPLiberate/site` repo and bootstrap MkDocs or Docusaurus.
  - [ ] Add pages: Overview, Getting Started, BLE Protocol, FAQ, Security & Safety.
  - [ ] Publish via GitHub Pages; enforce HTTPS.

- Community modules repo
  - [ ] Create `SFPLiberate/modules` repo.
  - [ ] Add initial `index.json` (empty array) and `CONTRIBUTING.md` with submission steps.
  - [ ] Add GitHub Action `validate.yml` to:
        - validate JSON schema (ajv or python jsonschema)
        - validate binary size range (e.g., 128–512 bytes)
        - compute sha256 and ensure filename match
        - check duplicate serial/model conflicts (warn)
  - [ ] Add LICENSE and security disclaimer.
  - [ ] Enable Discussions for coordination.
  - [ ] Configure CORS headers for `index.json` and blobs (GitHub Pages serves permissive CORS by default; verify).

- Submission flow
  - [ ] Support no-sign-in submissions from the app via backend inbox (`POST /api/submissions`).
        - Submissions stored on disk for maintainers to triage and publish to the modules repo.
        - Include `metadata.json` + `eeprom.bin`, compute sha256 for de-duplication.
  - [ ] Document how to export from SFPLiberate frontend (download .bin + .json metadata) for manual PRs.
  - [ ] PR template for new modules (attach .bin and .json, update `index.json`).

- Consumption flow
  - [ ] Document how the app fetches `index.json` and `blob_url` to import into the local DB.
  - [ ] Provide versioning policy for index format.
  - [ ] Consider signature/attestation of modules in future (PGP or Sigstore).

## Duplicate detection

- [ ] Use sha256 of `eeprom.bin` to detect duplicates (backend enforces unique index; frontend can pre-check).
- [ ] Add CLI or Action to reindex and flag duplicates across the repository.
