# Contributing

Thanks for your interest in contributing to SFPLiberate! The most impactful area right now is reverse‑engineering and implementing the SFP write path.

## Getting Started

- Use `docker-compose up --build` to run the app at `http://localhost:8080`.
- API docs are available at `http://localhost:8080/api/docs`.

## Pull Requests

- Keep changes focused and minimal.
- Update docs when behavior changes.
- Include TODOs for known follow‑ups when appropriate.

## Coding Style

- Frontend: vanilla JS, keep browser compatibility in mind (Safari limitations).
- Backend: Python 3.11+, FastAPI; prefer explicit typing where easy.

## BLE Protocol Work

- Use official mobile app + nRF Connect to sniff BLE traffic.
- Document any new commands/characteristics you discover.
- Note: Core read/write actions occur on-device; BLE primarily mirrors logs/data. If text commands exist (e.g., `[POST] /...`), validate across firmware versions before relying on them.

## Disclaimer

This project is not affiliated with Ubiquiti. Firmware updates may change BLE behavior and break functionality. Use at your own risk.
