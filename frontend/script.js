// --- Configuration ---
// BLE Service and Characteristics for SFP Wizard (Firmware v1.0.10)
// These UUIDs were discovered through reverse engineering - see docs/BLE_API_SPECIFICATION.md
const SFP_SERVICE_UUID = "8e60f02e-f699-4865-b83f-f40501752184";
const WRITE_CHAR_UUID = "9280f26c-a56f-43ea-b769-d5d732e1ac67"; // For sending commands
const NOTIFY_CHAR_UUID = "dc272a22-43f2-416b-8fa5-63a071542fac"; // For receiving data/logs
// Note: Secondary notify characteristic exists but is not currently subscribed to or used.
// Purpose is unclear from reverse engineering. May be used for file transfers, progress updates,
// or battery-level pushes. Consider subscribing and logging to discover its function.
const NOTIFY_CHAR_SECONDARY_UUID = "d587c47f-ac6e-4388-a31c-e6cd380ba043"; // Secondary notify (purpose TBD)
const BLE_WRITE_CHUNK_SIZE = 20; // Conservative chunk size for maximum BLE compatibility
const BLE_WRITE_CHUNK_DELAY_MS = 10; // Delay between chunks (ms). Can be reduced for faster writes if device supports it.
const TESTED_FIRMWARE_VERSION = "1.0.10"; // Firmware version this app was developed and tested with
// The frontend is reverse-proxied to the backend at /api by NGINX
const API_BASE_URL = "/api";
// Public community index (to be hosted on GitHub Pages)
// TODO: Create the community modules repository and publish to GitHub Pages
// Expected URL pattern: https://username.github.io/SFPLiberate-modules/index.json
const COMMUNITY_INDEX_URL = "https://josiah-nelson.github.io/SFPLiberate-modules/index.json";

// --- Global State ---
let bleDevice = null;
let gattServer = null;
let writeCharacteristic = null;
let notifyCharacteristic = null;
let rawEepromData = null; // Holds the raw ArrayBuffer of the last read
let deviceVersion = null; // Stores the device firmware version
let statusCheckInterval = null; // Interval for periodic status checks
let messageListeners = []; // Array of {pattern: string, resolve: function, reject: function, timeout: number}
// TODO: Accumulate DDM samples for CSV export (future)
let ddmSamples = [];
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

// --- DOM References ---
document.addEventListener('DOMContentLoaded', () => {
    const connectButton = document.getElementById('connectButton');
    const readSfpButton = document.getElementById('readSfpButton');
    const saveModuleButton = document.getElementById('saveModuleButton');
    const loadModulesButton = document.getElementById('loadModulesButton');
    const uploadCommunityButton = document.getElementById('uploadCommunityButton');
    const loadCommunityModulesButton = document.getElementById('loadCommunityModulesButton');
    const importFromFileButton = document.getElementById('importFromFileButton');
    const backupAllButton = document.getElementById('backupAllButton');
    const moduleList = document.getElementById('moduleList');
    const supportBanner = ensureSupportBanner();

    // --- Event Listeners ---
    connectButton.onclick = connectToDevice;
    readSfpButton.onclick = requestSfpRead;
    saveModuleButton.onclick = saveCurrentModule;
    uploadCommunityButton.onclick = uploadToCommunityTODO;
    loadCommunityModulesButton.onclick = loadCommunityModulesTODO;
    importFromFileButton.onclick = importFromFileTODO;
    backupAllButton.onclick = backupAllTODO;
    loadModulesButton.onclick = loadSavedModules;

    // Use event delegation for buttons on dynamic content (module list)
    moduleList.onclick = (event) => {
        const target = event.target;
        const moduleId = target.dataset.id;

        if (target.classList.contains('btn-write')) {
            writeSfp(moduleId);
        }
        if (target.classList.contains('btn-delete')) {
            deleteModule(moduleId);
        }
    };
    // Feature support notice
    if (!isWebBluetoothAvailable()) {
        disableBleUI();
        supportBanner.textContent = supportMessageForBrowser();
        supportBanner.classList.remove('hidden');
    }
});

// --- Feature Detection Helpers ---
function isWebBluetoothAvailable() {
    return !!(navigator && navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function');
}

function isSafari() {
    const ua = navigator.userAgent;
    const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Chromium\//.test(ua) && !/Edg\//.test(ua);
    return isSafari;
}

function ensureSupportBanner() {
    let el = document.getElementById('supportBanner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'supportBanner';
        el.style.margin = '1rem 0';
        el.style.padding = '0.75rem';
        el.style.border = '1px solid var(--border-color)';
        el.style.background = 'rgba(233,69,96,0.1)';
        var mainContainer = document.querySelector('main.container');
        if (mainContainer && mainContainer.prepend) {
            mainContainer.prepend(el);
        }
    }
    return el;
}

function supportMessageForBrowser() {
    if (isSafari()) {
        return 'Web Bluetooth is limited in Safari (especially on iOS). Use Chrome/Edge if possible. On macOS Safari, enable Web Bluetooth in Develop > Experimental Features if available.';
    }
    return 'This browser does not support Web Bluetooth. Please use a compatible browser (e.g., Chrome, Edge, or Opera).';
}

function disableBleUI() {
    const connectButton = document.getElementById('connectButton');
    connectButton.disabled = true;
}

// --- Log Helper ---
function log(message, isError = false) {
    const logConsole = document.getElementById('logConsole');
    const entry = document.createElement('div');
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    if (isError) {
        entry.style.color = "var(--error-color)";
    }
    logConsole.prepend(entry);
}

// --- Message Waiting Helper ---
/**
 * Waits for a specific message pattern from the BLE device.
 * Returns a promise that resolves when a notification containing the pattern is received.
 * Includes a timeout as a safety fallback.
 * @param {string} pattern - The text pattern to match in incoming notifications
 * @param {number} timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns {Promise<string>} - Resolves with the matched message text
 */
function waitForMessage(pattern, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            // Remove this listener from the array
            const index = messageListeners.findIndex(listener => listener.resolve === resolve);
            if (index !== -1) {
                messageListeners.splice(index, 1);
            }
            reject(new Error(`Timeout waiting for message: "${pattern}"`));
        }, timeoutMs);

        messageListeners.push({
            pattern,
            resolve: (message) => {
                clearTimeout(timeoutId);
                resolve(message);
            },
            reject: (error) => {
                clearTimeout(timeoutId);
                reject(error);
            },
            timeoutId
        });
    });
}

// --- 1. BLE Connection Logic ---
async function connectToDevice() {
    log("Requesting BLE device...");
    try {
        // Some browsers (notably Safari) may not support filtering by custom 128-bit UUIDs.
        // Attempt a filtered request first; if it fails or we're on Safari, fall back to acceptAllDevices.
        const wantsFallback = isSafari();
        let requestOptions = wantsFallback
            ? { acceptAllDevices: true, optionalServices: [SFP_SERVICE_UUID] }
            : { filters: [{ services: [SFP_SERVICE_UUID] }], optionalServices: [SFP_SERVICE_UUID] };

        try {
            bleDevice = await navigator.bluetooth.requestDevice(requestOptions);
        } catch (firstErr) {
            // Fallback path for browsers that reject custom UUID filters
            log(`Filtered request failed (${firstErr}). Trying broad scan...`);
            bleDevice = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [SFP_SERVICE_UUID] });
        }

        bleDevice.addEventListener('gattserverdisconnected', onDisconnected);
        log("Connecting to GATT server...");
        gattServer = await bleDevice.gatt.connect();

        log("Getting primary service...");
        const service = await gattServer.getPrimaryService(SFP_SERVICE_UUID);

        log("Getting Write characteristic...");
        writeCharacteristic = await service.getCharacteristic(WRITE_CHAR_UUID);

        log("Getting Notify characteristic...");
        notifyCharacteristic = await service.getCharacteristic(NOTIFY_CHAR_UUID);

        log("Starting notifications...");
        await notifyCharacteristic.startNotifications();
        notifyCharacteristic.addEventListener('characteristicvaluechanged', handleNotifications);

        log("Successfully connected!");
        updateConnectionStatus(true);

        // Get device version and start periodic status checks
        await getDeviceVersion();
        startStatusMonitoring();

    } catch (error) {
        log(`Connection failed: ${error}`, true);
        updateConnectionStatus(false);
    }
}

function onDisconnected() {
    log("Device disconnected.", true);
    updateConnectionStatus(false);
    stopStatusMonitoring();
    deviceVersion = null;

    // Reject any pending message listeners to prevent memory leaks and hanging promises
    messageListeners.forEach(listener => {
        clearTimeout(listener.timeoutId);
        listener.reject(new Error("Device disconnected"));
    });
    messageListeners = [];

    // Optionally, try to reconnect
}

function updateConnectionStatus(isConnected) {
    const bleStatus = document.getElementById('bleStatus');
    const readSfpButton = document.getElementById('readSfpButton');

    if (isConnected) {
        bleStatus.textContent = "Connected";
        bleStatus.dataset.status = "connected";
        readSfpButton.disabled = false;
    } else {
        bleStatus.textContent = "Disconnected";
        bleStatus.dataset.status = "disconnected";
        document.getElementById('sfpStatus').textContent = "Unknown";
        document.getElementById('sfpStatus').dataset.status = "unknown";
        readSfpButton.disabled = true;
        document.getElementById('liveDataArea').classList.add('hidden');
    }
}

/**
 * Gets the device firmware version using the discovered API endpoint
 */
async function getDeviceVersion() {
    try {
        log("Requesting device version...");
        await sendBleCommand("/api/1.0/version");
        // The response will be handled in handleNotifications
        // and will look like "Version: 1.0.10"
    } catch (error) {
        log(`Failed to get device version: ${error}`, true);
    }
}

/**
 * Requests device status using the discovered API endpoint
 */
async function requestDeviceStatus() {
    try {
        await sendBleCommand("[GET] /stats");
        // The response will be handled in handleNotifications
        // Format: "sysmon: ver:1.0.10, bat:[x]|^|35%, sfp:[x], ..."
    } catch (error) {
        log(`Failed to get device status: ${error}`, true);
    }
}

/**
 * Starts periodic status monitoring of the connected device.
 *
 * Note: This polls the device every 5 seconds regardless of whether the data
 * is actively used, creating BLE traffic and battery drain. This approach was
 * chosen for simplicity and to ensure status is always current. Future
 * optimizations could include:
 * - Only polling when status UI is visible
 * - Event-driven updates instead of polling
 * - User-configurable polling interval or manual refresh
 * - Stopping monitoring during long operations (reads/writes)
 */
function startStatusMonitoring() {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
    }
    // Check status every 5 seconds
    statusCheckInterval = setInterval(() => {
        if (gattServer && gattServer.connected) {
            requestDeviceStatus();
        }
    }, 5000);
    // Also check immediately
    requestDeviceStatus();
}

/**
 * Stops periodic status monitoring
 */
function stopStatusMonitoring() {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
        statusCheckInterval = null;
    }
}

// --- 2. BLE Data Handling (The "Brain") ---

/**
 * This is the core logic. It handles all incoming data from the 
 * SFP Wizard device.
 */
function handleNotifications(event) {
    const value = event.target.value; // DataView
    // Convert DataView to Uint8Array for broad browser compatibility (Safari included)
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);

    // Heuristic: if all bytes are printable ASCII (and newline/carriage return), treat as text
    let isLikelyText = true;
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (!(b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126))) {
            isLikelyText = false;
            break;
        }
    }

    let textResponse = null;
    if (isLikelyText) {
        try {
            textResponse = textDecoder.decode(bytes);
        } catch (_) {
            textResponse = null;
        }
    }

    if (textResponse) {
        log(`Received Text: ${textResponse.trim()}`);

        // Check if it's a version response
        if (textResponse.includes('Version:')) {
            const versionMatch = textResponse.match(/Version:\s*([0-9.]+)/i);
            if (versionMatch) {
                deviceVersion = versionMatch[1];
                log(`Device firmware version: ${deviceVersion}`);
                // Check if it's the expected version
                if (deviceVersion !== TESTED_FIRMWARE_VERSION) {
                    log(`⚠️ Warning: This app was developed for firmware v${TESTED_FIRMWARE_VERSION}. You have v${deviceVersion}. Some features may not work correctly.`, true);
                }
            }
        }

        // Check if it's the periodic status monitor
        if (textResponse.includes('sysmon:')) {
            const sfpStatus = document.getElementById('sfpStatus');
            if (textResponse.includes('sfp:[x]')) {
                sfpStatus.textContent = "Module Present";
                sfpStatus.dataset.status = "yes";
            } else if (textResponse.includes('sfp:[ ]')) {
                sfpStatus.textContent = "No Module";
                sfpStatus.dataset.status = "no";
            }

            // Extract and display battery level
            const batteryMatch = textResponse.match(/bat:\[.\]\|\^?\|(\d+)%/);
            if (batteryMatch) {
                const batteryLevel = batteryMatch[1];
                log(`Device battery level: ${batteryLevel}%`);

                // Display battery level in UI if element exists
                const batteryStatus = document.getElementById('batteryStatus');
                if (batteryStatus) {
                    batteryStatus.textContent = `Battery: ${batteryLevel}%`;
                    batteryStatus.dataset.level = batteryLevel;
                }
            }
        }

        // Check for SIF operation acknowledgments
        const ackMessages = {
            'SIF start': "Device acknowledged read operation - waiting for EEPROM data...",
            'SIF write start': "Device acknowledged write operation - ready to receive data",
            'SIF write stop': "Device confirmed write operation completed",
            'SIF write complete': "Device confirmed write operation completed",
            'SIF erase start': "Device started erase operation",
            'SIF erase stop': "Device completed erase operation",
            'SIF stop': "Device stopped SIF operation",
        };

        for (const [key, message] of Object.entries(ackMessages)) {
            if (textResponse.includes(key)) {
                log(message);

                // Notify any waiting listeners
                const matchedListeners = messageListeners.filter(listener =>
                    textResponse.includes(listener.pattern)
                );
                matchedListeners.forEach(listener => {
                    listener.resolve(textResponse);
                });
                // Remove all matched listeners in one pass
                messageListeners = messageListeners.filter(l => !matchedListeners.includes(l));
                break; // Process first match only
            }
        }

        // TODO: DDM capture
        if (/ddm:/i.test(textResponse)) {
            // Example parsing; actual format TBD from logs
            ddmSamples.push({ ts: Date.now(), line: textResponse.trim() });
        }
        // Handle other text responses, e.g., "Write OK", "Error", etc.
    } else {
        // --- IT'S BINARY DATA ---
        // This is the SFP EEPROM data we requested
        log(`Received ${value.buffer.byteLength} bytes of binary SFP data.`);
        rawEepromData = value.buffer; // Save the raw ArrayBuffer
        parseAndDisplaySfpData(rawEepromData);

        // Enable the save button
        document.getElementById('saveModuleButton').disabled = false;
        // Enable community upload after a successful read
        const uploadBtn = document.getElementById('uploadCommunityButton');
        if (uploadBtn) uploadBtn.disabled = false;
        document.getElementById('liveDataArea').classList.remove('hidden');
    }
}

/**
 * Send a command (as a text string) to the SFP Wizard.
 */
async function sendBleCommand(command) {
    if (!writeCharacteristic) {
        log("Not connected.", true);
        return;
    }
    try {
        const encodedCommand = textEncoder.encode(command);
        await writeCharacteristic.writeValueWithoutResponse(encodedCommand);
        log(`Sent Command: ${command}`);
    } catch (error) {
        log(`Failed to send command: ${error}`, true);
    }
}

// --- 3. SFP Read/Parse Logic ---

function requestSfpRead() {
    // Trigger SFP EEPROM read using the discovered BLE API endpoint
    // The device will respond with "SIF start" followed by binary EEPROM data
    log("Sending SFP read command to device...");
    sendBleCommand("[POST] /sif/start");
    log("Waiting for EEPROM data...");
}

/**
 * Parses the raw SFP data (SFF-8472 spec) and updates the UI.
 */
function parseAndDisplaySfpData(arrayBuffer) {
    const asciiDecoder = new TextDecoder('ascii');

    if (arrayBuffer.byteLength < 96) {
        log("EEPROM data is too short.", true);
        return;
    }

    // SFF-8472 Address A0h Offsets
    const vendor = asciiDecoder.decode(arrayBuffer.slice(20, 36)).trim();
    const model = asciiDecoder.decode(arrayBuffer.slice(40, 56)).trim();
    const serial = asciiDecoder.decode(arrayBuffer.slice(68, 84)).trim();

    document.getElementById('sfp-vendor').textContent = `Vendor: ${vendor || 'N/A'}`;
    document.getElementById('sfp-model').textContent = `Model:  ${model || 'N/A'}`;
    document.getElementById('sfp-serial').textContent = `Serial: ${serial || 'N/A'}`;
}

// --- 4. Backend API (Library) Functions ---

/**
 * Fetches the list of saved modules from our Docker backend.
 */
async function loadSavedModules() {
    log("Loading module library from backend...");
    try {
        const response = await fetch(`${API_BASE_URL}/modules`);
        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }
        const modules = await response.json();

        const moduleList = document.getElementById('moduleList');
        moduleList.innerHTML = ""; // Clear existing list

        if (modules.length === 0) {
            moduleList.innerHTML = "<li>No modules saved yet.</li>";
        }

        modules.forEach(module => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div class="info">
                    <strong>${module.name}</strong>
                    ${module.vendor} - ${module.model}
                </div>
                <div class="actions">
                    <button class="btn-write" data-id="${module.id}">Write</button>
                    <button class="btn-delete" data-id="${module.id}">Delete</button>
                </div>
            `;
            moduleList.appendChild(li);
        });
        document.getElementById('moduleLibrary').classList.remove('hidden');

    } catch (error) {
        log(`Failed to load library: ${error}`, true);
    }
}

/**
 * Saves the currently read module data to the backend.
 */
async function saveCurrentModule() {
    const name = document.getElementById('moduleNameInput').value;
    if (!name) {
        alert("Please enter a friendly name for the module.");
        return;
    }
    if (!rawEepromData) {
        alert("No SFP data has been read yet.");
        return;
    }

    log("Saving module to backend...");

    // Convert ArrayBuffer to Base64 string to send as JSON
    const base64Data = bufferToBase64(rawEepromData);

    try {
        const response = await fetch(`${API_BASE_URL}/modules`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: name,
                eeprom_data_base64: base64Data
            })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.detail || "Failed to save.");
        }

        if (result.status === 'duplicate') {
            log(`Duplicate detected (SHA256). Using existing ID: ${result.id}`);
        } else {
            log(`Module saved with ID: ${result.id}`);
        }
        document.getElementById('moduleNameInput').value = "";
        loadSavedModules(); // Refresh the list

    } catch (error) {
        log(`Failed to save module: ${error}`, true);
    }
}

/**
 * Deletes a module from the backend database.
 */
async function deleteModule(moduleId) {
    if (!confirm("Are you sure you want to delete this module?")) {
        return;
    }

    log(`Deleting module ${moduleId}...`);
    try {
        const response = await fetch(`${API_BASE_URL}/modules/${moduleId}`, {
            method: 'DELETE'
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.detail || "Failed to delete.");
        }

        log(result.message);
        loadSavedModules(); // Refresh the list

    } catch (error) {
        log(`Failed to delete: ${error}`, true);
    }
}

/**
 * Fetches a module's binary data and writes it to the SFP.
 * Uses the discovered BLE write protocol: [POST] /sif/write
 */
async function writeSfp(moduleId) {
    if (!bleDevice || !gattServer || !gattServer.connected) {
        alert("Please connect to the SFP Wizard first.");
        return;
    }

    // Safety warning
    const confirmed = confirm(
        "⚠️ WARNING: Writing EEPROM data can permanently damage your SFP module if incorrect data is used.\n\n" +
        "Before proceeding:\n" +
        "✓ Ensure you have backed up the original module data\n" +
        "✓ Verify this is the correct module profile\n" +
        "✓ Use test/non-critical modules first\n\n" +
        "Do you want to continue?"
    );

    if (!confirmed) {
        log("Write operation cancelled by user.");
        return;
    }

    log(`Preparing to write module ${moduleId}...`);

    try {
        // 1. Fetch the binary EEPROM data from our backend
        log("Fetching EEPROM data from backend...");
        const response = await fetch(`${API_BASE_URL}/modules/${moduleId}/eeprom`);
        if (!response.ok) {
            throw new Error("Module binary data not found.");
        }
        const eepromData = await response.arrayBuffer();
        log(`Retrieved ${eepromData.byteLength} bytes of EEPROM data.`);

        // 2. Send the write initiation command to the SFP Wizard
        log("Sending write initiation command: [POST] /sif/write");
        await sendBleCommand("[POST] /sif/write");

        // 3. Wait for "SIF write start" acknowledgment
        log("Waiting for device acknowledgment...");
        try {
            await waitForMessage("SIF write start", 5000);
            log("Device ready to receive EEPROM data.");
        } catch (error) {
            log(`Warning: ${error.message}. Proceeding anyway...`, true);
            // Continue with write attempt even if acknowledgment times out
        }

        // 4. Chunk and send the binary data
        // Using conservative chunk size for maximum compatibility
        const totalChunks = Math.ceil(eepromData.byteLength / BLE_WRITE_CHUNK_SIZE);
        log(`Writing ${eepromData.byteLength} bytes in ${totalChunks} chunks...`);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * BLE_WRITE_CHUNK_SIZE;
            const end = Math.min(start + BLE_WRITE_CHUNK_SIZE, eepromData.byteLength);
            const chunk = eepromData.slice(start, end);

            try {
                await writeCharacteristic.writeValueWithoutResponse(chunk);

                // Progress indication
                if ((i + 1) % 10 === 0 || i === totalChunks - 1) {
                    const progress = Math.round(((i + 1) / totalChunks) * 100);
                    log(`Write progress: ${progress}% (${i + 1}/${totalChunks} chunks)`);
                }

                // Small delay between chunks to avoid overwhelming the device
                // Note: This conservative delay (~2KB/s for 256-byte EEPROM) prioritizes
                // compatibility. Can be reduced (or set to 0) for faster writes if your
                // device supports it. Adjust BLE_WRITE_CHUNK_DELAY_MS constant at top of file.
                if (BLE_WRITE_CHUNK_DELAY_MS > 0) {
                    await new Promise(resolve => setTimeout(resolve, BLE_WRITE_CHUNK_DELAY_MS));
                }
            } catch (chunkError) {
                throw new Error(`Failed to write chunk ${i + 1}/${totalChunks}: ${chunkError}`);
            }
        }

        log("All data chunks sent successfully.");
        log("Waiting for write completion confirmation...");

        // Wait for completion message. The device can send either message, so we'll race them.
        try {
            await Promise.race([
                waitForMessage("SIF write stop", 10000),
                waitForMessage("SIF write complete", 10000)
            ]);
            log("✓ Write operation completed!", false);
        } catch (error) {
            log(`Warning: ${error.message}. Write may have completed anyway.`, true);
            log("✓ Write operation likely completed (no confirmation received)", false);
        }
        log("⚠️ IMPORTANT: Verify the write by reading the module back and comparing data.", false);

        alert(
            "Write operation completed!\n\n" +
            "NEXT STEPS:\n" +
            "1. Read the module back using the Read button\n" +
            "2. Compare the data to verify successful write\n" +
            "3. Test the module in your equipment"
        );

    } catch (error) {
        log(`Failed to write SFP: ${error}`, true);
        alert(`Write operation failed: ${error.message}\n\nThe module may be in an unknown state. Do not use until verified.`);
    }
}

// --- Utility Functions ---
function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

// --- Scanning (Discovery) TODO scaffolding ---
// Limited scanning functionality to discover devices vs static UUIDs
// TODO: Use the Bluetooth Scanning API (requestLEScan) when available to
// discover SFP Wizard devices passively and present them in a list.
// This API is currently supported in Chromium-based browsers; Safari support
// is limited. For Safari/macOS with experimental Web Bluetooth, fall back to
// requestDevice with acceptAllDevices and instruct the user to pick the device.
async function limitedScanTODO() {
    try {
        if (navigator.bluetooth && typeof navigator.bluetooth.requestLEScan === 'function') {
            log('Starting low-energy scan (experimental)...');
            const scan = await navigator.bluetooth.requestLEScan({ keepRepeatedDevices: false });
            // TODO: attach navigator.bluetooth.addEventListener('advertisementreceived', handler)
            // and populate a discovery list in the UI.
            // For now, we simply stop immediately to avoid leaving scans running.
            await new Promise((r) => setTimeout(r, 2000));
            scan.stop();
            log('Stopped low-energy scan. (TODO: implement handler and device selection UI)');
        } else {
            log('Scanning API not available. Falling back to requestDevice...', true);
            await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [SFP_SERVICE_UUID] });
        }
    } catch (err) {
        log(`Scan failed or was cancelled: ${err}`, true);
    }
}

// --- Community Upload / Import TODOs ---
async function uploadToCommunityTODO() {
    try {
        if (!rawEepromData) {
            alert('Read an SFP first.');
            return;
        }
        // TODO: Compute sha256 in browser for immediate duplicate checks
        const base64Data = bufferToBase64(rawEepromData);
        const vendor = document.getElementById('sfp-vendor').textContent.replace('Vendor: ','');
        const model = document.getElementById('sfp-model').textContent.replace('Model:  ','');
        const serial = document.getElementById('sfp-serial').textContent.replace('Serial: ','');
        const name = document.getElementById('moduleNameInput').value || `${vendor} ${model}`.trim();
        const res = await fetch(`${API_BASE_URL}/submissions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, vendor, model, serial, eeprom_data_base64: base64Data })
        });
        const out = await res.json();
        if (!res.ok) throw new Error(out.detail || 'Submission failed');
        log(`Community submission queued. Inbox ID: ${out.inbox_id}, sha256: ${out.sha256}`);
        alert('Thanks! Your module was queued for community review.');
    } catch (err) {
        log(`Community upload failed: ${err}`, true);
    }
}

async function loadCommunityModulesTODO() {
    try {
        log('Fetching community index (TODO)...');
        // TODO: fetch COMMUNITY_INDEX_URL and render list in #communityModuleList
        // Example: const res = await fetch(COMMUNITY_INDEX_URL, { cache: 'no-store' });
        // const idx = await res.json();
        const container = document.getElementById('communityModuleLibrary');
        const list = document.getElementById('communityModuleList');
        if (list) {
            list.innerHTML = '<li>TODO: Fetch and list modules from community index.</li>';
        }
        if (container) container.classList.remove('hidden');
        alert('TODO: Community listing not yet implemented.');
    } catch (err) {
        log(`Failed to load community modules: ${err}`, true);
    }
}

async function importFromFileTODO() {
    try {
        const input = document.getElementById('importFileInput');
        if (!input || !input.files || input.files.length === 0) {
            alert('Select a .bin or .json file first.');
            return;
        }
        const file = input.files[0];
        // TODO: Implement reading metadata JSON or raw BIN and saving to backend.
        log(`TODO: Importing from file '${file.name}' not yet implemented.`);
        alert('TODO: Import from file (supports .json or .bin)');
    } catch (err) {
        log(`Import failed: ${err}`, true);
    }
}

async function backupAllTODO() {
    try {
        // TODO: Implement endpoint to export all modules as JSON/CSV/zip and trigger browser download.
        log('TODO: Backup/Export not yet implemented (CSV + ZIP).');
        alert('TODO: Backup/Export all modules to CSV/ZIP');
    } catch (err) {
        log(`Backup failed: ${err}`, true);
    }
}
