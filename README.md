# SFPLiberate

**A community-driven web tool to unlock the full potential of the Unifi SFP Wizard.**

`SFPLiberate` is a companion web application for the **Ubiquiti SFP Wizard (UACC‑SFP‑Wizard)**, a portable, ESP32‑class SFP/SFP+ module programmer. The SFP Wizard performs reading/writing on‑device; meanwhile it broadcasts diagnostic logs and data over BLE. This app connects over Web Bluetooth to capture those broadcasts, parse module details, and save profiles to a local library you control. It aims to enable writing saved profiles back to modules, historical DDM logging (CSV, future), and a community repository of module data, compatibility notes, and statistics.

This project is built on a modern web stack, using your browser's **Web Bluetooth API** to subscribe to the SFP Wizard’s BLE logs/data and a **Dockerized Python backend** to manage your module library. The frontend is served by NGINX which also reverse‑proxies API calls at `/api` to the backend for a single‑origin experience (no CORS headaches).

## The Goal

The Ubiquiti SFP Wizard is a powerful standalone device designed to reprogram, test, and unlock compatibility for optical modules. Two practical limitations for power users today:

- It cannot store more than one module profile at a time for writing.
- There’s no way to "copy" a module unless you already have one inserted.

The goal of `SFPLiberate` is to complement the device with a "pro" workflow for network engineers and hobbyists to:

-   **Read & Archive:** Read the full EEPROM from any SFP module and save it to a persistent, searchable library.
    
-   **Document:** Store diagnostic metrics and historical data for documentation and review.
    
-   **Clone & Reprogram:** Write EEPROM data from your library (e.g., a "known-good" Cisco config) onto a new or rewritable module. If BLE write is not supported, use the device’s on‑device push while the app provides your saved profiles.
    
-   **Liberate:** Free your modules from vendor lock‑ins by creating and sharing your own library of configurations, plus compatibility notes and statistics.
    

## How It Works (The Method)

This tool is the result of reverse‑engineering the SFP Wizard's Bluetooth LE (BLE) behavior.

1.  **Discovery:** By analyzing `syslog` output and sniffing BLE with nRF Connect, we observed that the device broadcasts human‑readable logs and data frames over a BLE characteristic. Core read/write actions occur on‑device; BLE primarily mirrors state and data.
    
2.  **BLE Interface:** Status updates like `sysmon: ... sfp:[x]` indicate module presence. Some command strings may exist (e.g., text that looks like `[POST] ...`) but their availability and behavior are not guaranteed. Reading/writing is known to be performed on‑device; triggering such actions via BLE requires further discovery.
    
3.  **Architecture:** This app is split into two parts:
    
    -   **Frontend (Browser):** A static HTML/CSS/JS application that uses the **Web Bluetooth API** (`navigator.bluetooth`) to connect directly to the SFP Wizard and capture logs/data (including EEPROM dumps) for parsing and saving.
        
    -   **Backend (Docker):** A lightweight **Python (FastAPI)** server that runs in a Docker container. Its only job is to provide a REST API for storing and retrieving module data from an **SQLite** database.
        

This architecture means the complex BLE communication happens securely in your browser, while your module library is safely managed and stored by a robust backend.

## Current Features & Functionality

-   **Connect to Device:** Scan for and connect to the SFP Wizard via Web Bluetooth.
    
-   **Live Status:** Real-time status detection for BLE connection and SFP module presence.
    
-   **Capture SFP EEPROM:** Capture EEPROM data (e.g., 256+ bytes) broadcast by the device when a read is performed on‑device. If a BLE trigger command exists, it will be integrated once discovered.
    
-   **Parse SFP Data:** On‑the‑fly parsing of SFP EEPROM data (based on SFF‑8472 spec) to display Vendor, Model, and Serial Number.
    
-   **Module Library (Backend):**
    
    -   `GET /api/modules`: Load all saved modules.
        
    -   `POST /api/modules`: Save a newly read module to the database.
        
    -   `DELETE /api/modules/{id}`: Delete a module from the library.
        
    -   `GET /api/modules/{id}/eeprom`: Get the raw binary EEPROM data for a specific module, ready for writing.
        
-   **Save to Library:** Save a newly captured module with a friendly name to your library. Duplicate detection by checksum is implemented.
    
-   **Load from Library:** View your entire library of saved modules in the UI.
    

## Project Roadmap & TODO

This project is fully functional for capturing and archiving profiles. Writing saved profiles back to modules will depend on discovering a safe, compatible workflow (on‑device only, or BLE‑assisted if available).

-   [x] **UI:** Create the HTML/CSS/JS frontend.
    
-   [x] **Backend:** Create the Dockerized FastAPI/SQLite backend.
    
-   [x] **BLE Connect:** Implement Web Bluetooth connection and status logic.
    
-   [x] **SFP Capture:** Capture and parse EEPROM data broadcast by the device when reads are performed on‑device.
    
-   [x] **EEPROM Parse:** Implement SFF-8472 parsing in JavaScript.
    
-   [x] **Save/Load:** Implement `fetch` calls to save/load from the backend API.
    
-   [x] **SFP Write:** ✅ **IMPLEMENTED** - See `docs/ISSUE_4_IMPLEMENTATION.md` for details.

    -   **Status:** BLE write protocol has been reverse-engineered and implemented.

    -   **Endpoint:** `[POST] /sif/write` followed by chunked binary data transfer.

    -   **Features:** Safety confirmations, progress tracking, chunking for compatibility, detailed logging.

    -   **Safety:** Includes pre-write warnings, post-write verification recommendations, and error handling.
        
-   [ ] **DDM Logging (CSV):**

    -   **Task:** Capture DDM telemetry lines broadcast over BLE and persist snapshots for historical logging.
    -   **Implement:** Add CSV export of DDM over time (frontend button + backend endpoint). Consider configurable sampling.

-   [ ] **Device Discovery (Limited Scanning):**
    
    -   **Task:** Add support for discovering devices without relying solely on static service UUID filters.
    
    -   **Current:** A scaffold `limitedScanTODO()` exists in `frontend/script.js`. Chromium browsers can use the Bluetooth Scanning API (`navigator.bluetooth.requestLEScan`) to passively discover devices; Safari support is limited. The app falls back to a broad `requestDevice({ acceptAllDevices: true, optionalServices: [...] })` when necessary (e.g., Safari/macOS).
    
    -   **Implement:** Hook advertisement events to a small UI list, and allow selecting the SFP Wizard from discovered devices.

-   [ ] **Sidecar Site (GitHub Pages) + Community Modules Repository:**

    -   **Task:** Create a companion GitHub Pages site with docs and a public, curated repository of community‑shared SFP modules.
    
    -   **Plan:** See `docs/SIDECAR_SITE_TODO.md` for structure, `index.json` schema, and CI validation ideas.
    
    -   **Implement:** Bootstrap site (MkDocs/Docusaurus), create `SFPLiberate/modules` repo with `index.json`, CI validation, and contribution docs.

-   [ ] **Upload to Community (from Web UI):**

    -   **Task:** After reading an SFP, allow users to opt‑in to share their module to the community repository.
    
    -   **Plan:** Add an “Upload to Community (TODO)” button in the UI. No GitHub sign‑in required: submissions are posted to a backend inbox (`POST /api/submissions`) for maintainers to triage and publish to the modules repo. Also support a downloadable ZIP for manual PRs.
    
    -   **Implement:** Add an `uploadToCommunity()` stub that prepares `metadata.json` and raw `.bin` data, then either initiates OAuth flow or downloads an archive for manual PR.

-   [ ] **Import Community Modules (to Local DB):**

    -   **Task:** Let users browse and import community modules from the GitHub Pages index into their local database.
    
    -   **Plan:** Add a “Load Community Modules (TODO)” UI, fetch the public `index.json`, render a list, and allow import of selected items via a new backend endpoint (or direct binary fetch + existing save flow).
    
    -   **Implement:** Frontend `loadCommunityModulesTODO()` to fetch the index and display; backend `POST /api/modules/import` (TODO) to accept metadata + binary URL and persist. Use checksum to dedupe.

-   [ ] **Checksums & Backups:**
    -   **Duplicate detection:** Use SHA‑256 during import/export; dedupe on save/import.
    -   **Backups:** Export all modules (and future DDM logs) to CSV/ZIP; support manual import of those files.

## Safari Support

- iOS/iPadOS: Web Bluetooth is not supported. Use Chrome on Android or a desktop Chromium browser.
- macOS Safari: Recent versions have experimental Web Bluetooth support; enable from Develop → Experimental Features. Filtering by custom 128‑bit UUIDs may not work; the app will automatically fall back to broader device selection and then access the service via `optionalServices`.

## Build & Run Instructions

### Prerequisites

1.  **Docker & Docker Compose:** You must have Docker installed to run the backend.
    
2.  **A Compatible Browser:** Web Bluetooth is required. This works on **Google Chrome** (Desktop & Android), **Edge**, and **Opera**. Firefox does not support Web Bluetooth. Safari support is limited:
    - iOS/iPadOS Safari: not supported.
    - macOS Safari: limited/experimental in recent versions; enable Web Bluetooth in Develop → Experimental Features if available. The app falls back to broader device selection when filtering by custom UUIDs is not supported.
    
3.  **Hardware:** A Unifi SFP Wizard device.
    

### Running the Application

This project is built to run with a single command:

1.  **Clone the Repository:**
    
    ```
    git clone [https://github.com/your-username/SFPLiberate.git](https://github.com/your-username/SFPLiberate.git)
    cd SFPLiberate
    
    ```
    
2.  Build and Run with Docker Compose:
    
    This command will:
    
    -   Build the backend (FastAPI) and frontend (NGINX) containers.
    -   Serve the frontend on `http://localhost:8080`.
    -   Reverse proxy API requests to the backend at `http://localhost:8080/api`.
        
    
    ```
    docker-compose up --build
    
    ```
    
3.  Access the App:
    
    Once the containers are running, open your Web Bluetooth-compatible browser (e.g., Chrome) and go to:
    
    http://localhost:8080
    
    _(Note: We use port `8080` to avoid conflicts with other local servers, but the `nginx` container serves on port `80`)._
    
4.  **Connect and Go!**
    
    -   Click the "Connect to SFP Wizard" button.
        
    -   Select your device from the popup.
        
    -   Start reading and building your library!
        

### Development

-   To stop the application: `docker-compose down`
    
-   To view logs: `docker-compose logs -f backend` or `docker-compose logs -f frontend`
    
-   The backend API docs are available at `http://localhost:8080/api/docs` when running.

## Configuration

### BLE UUIDs

✅ **CONFIGURED:** The BLE service and characteristic UUIDs have been discovered through reverse engineering and are now configured in `frontend/script.js` for firmware version 1.0.10.

**Current Configuration (Firmware v1.0.10):**
```javascript
const SFP_SERVICE_UUID = "8e60f02e-f699-4865-b83f-f40501752184";
const WRITE_CHAR_UUID = "9280f26c-a56f-43ea-b769-d5d732e1ac67";
const NOTIFY_CHAR_UUID = "dc272a22-43f2-416b-8fa5-63a071542fac";
```

The application will automatically detect the firmware version on connection and warn if it differs from the tested version (v1.0.10).

**Note:** If you have a different firmware version and these UUIDs don't work, you can use a BLE scanner app like [nRF Connect](https://www.nordicsemi.com/Products/Development-tools/nRF-Connect-for-mobile) to discover the UUIDs for your device.

For full API documentation, see `docs/BLE_API_SPECIFICATION.md`.

## Disclaimer

This project is an independent, community‑driven effort and is not affiliated with, endorsed by, or supported by Ubiquiti. The SFP Wizard’s firmware and BLE behavior may change at any time; this tool may stop working without notice if a firmware update alters the observed interfaces. Use at your own risk.
    

## Contributing

Contributions are highly encouraged! The most critical need is to reverse-engineer the SFP Write protocol. If you have any insights, please open an Issue or a Pull Request.
