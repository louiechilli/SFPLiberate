# BLE API Specification for SFP Wizard (v1.0.10)

**Status:** Reverse-Engineered
**Firmware Version:** 1.0.10
**Last Updated:** 2025-11-02
**Source:** Device log analysis and BLE traffic capture

## Overview

This document outlines the reverse-engineered API for the SFP Wizard (firmware ver:1.0.10). The device communicates over BLE using a text-based, REST-like API. All commands are sent as UTF-8 text strings to a "Write" characteristic, and responses are received as UTF-8 text or raw binary on "Notify" characteristics.

## BLE Service & Characteristics

### Primary Service
- **Service UUID:** `8E60F02E-F699-4865-B83F-F40501752184`

### Characteristics

#### Write Characteristic (Commands)
- **UUID:** `9280F26C-A56F-43EA-B769-D5D732E1AC67`
- **Properties:** Write
- **Description:** Accepts all text-based commands
- **Format:** UTF-8 encoded text strings

#### Notify Characteristic (Primary Response Channel)
- **UUID:** `DC272A22-43F2-416B-8FA5-63A071542FAC`
- **Properties:** Notify
- **Description:** Sends text-based acknowledgments (e.g., "SIF write start") and status/version info. Also serves as the primary channel for binary data dumps (e.g., SFP EEPROM read).
- **Format:** UTF-8 text for status messages, raw binary for EEPROM data

#### Secondary Notify Characteristic
- **UUID:** `D587C47F-AC6E-4388-A31C-E6CD380BA043`
- **Properties:** Notify
- **Description:** Secondary notification channel. Purpose is less clear but may be used for file transfer progress or battery-level pushes.

## API Endpoints

### 1. System: Get Version

**Description:** Fetches the device's firmware version.

**Endpoint:** `/api/1.0/version`

**Request Format:**
```
Type: Text (UTF-8)
Payload: "/api/1.0/version"
```

**Response Format:**
```
Channel: DC272A22-43F2-416B-8FA5-63A071542FAC (Notify)
Type: Text (UTF-8)
Example: "Version: 1.0.10"
```

**Request Schema:**
```json
{
  "type": "text",
  "payload": "/api/1.0/version"
}
```

**Response Schema:**
```json
{
  "type": "text",
  "example": "Version: 1.0.10"
}
```

---

### 2. System: Get Status

**Description:** Fetches device status, including SFP presence, battery, and uptime.

**Endpoint:** `[GET] /stats`

**Request Format:**
```
Type: Text (UTF-8)
Payload: "[GET] /stats"
```

**Response Format:**
```
Channel: DC272A22-43F2-416B-8FA5-63A071542FAC (Notify)
Type: Text (UTF-8)
```

The response is a formatted text string. Key elements:
- `sfp:[ ]` - No SFP module present
- `sfp:[x]` - SFP module present
- `bat:[x]|^|XX%` - Battery status and percentage
- `ble:[x]` - Bluetooth enabled
- `ver:X.X.XX` - Firmware version

**Request Schema:**
```json
{
  "type": "text",
  "payload": "[GET] /stats"
}
```

**Response Schema:**
```json
{
  "type": "text",
  "example": "sysmon: ver:1.0.10, bat:[x]|^|35%, sfp:[ ], qsf:[ ], ble:[x], /fs:1.76%, dma: 46.41%, heap: 96.55%, spiram: 98.64%, mac:1c:6a:1b:05:f7:fe"
}
```

**Response Parsing:**
- Check for `sfp:[x]` (module present) or `sfp:[ ]` (no module)
- Extract battery percentage: `bat:[x]|^|XX%`
- Extract firmware version: `ver:X.X.XX`
- Extract MAC address: `mac:XX:XX:XX:XX:XX:XX`

---

### 3. SFP: Read EEPROM

**Description:** Initiates a read of the SFP module's EEPROM.

**Endpoint:** `[POST] /sif/start`

**Request Format:**
```
Type: Text (UTF-8)
Payload: "[POST] /sif/start"
```

**Response Flow:**

1. **Text Acknowledgment** (on DC272A22-43F2-416B-8FA5-63A071542FAC)
   ```
   Type: Text (UTF-8)
   Example: "SIF start"
   ```

2. **Binary EEPROM Data** (on DC272A22-43F2-416B-8FA5-63A071542FAC)
   ```
   Type: Binary
   Size: 256 or 512 bytes (typically)
   Format: Raw EEPROM dump
   ```

The device first sends a text acknowledgment, then immediately follows up with one or more notifications containing the raw binary EEPROM data.

**Request Schema:**
```json
{
  "type": "text",
  "payload": "[POST] /sif/start"
}
```

**Response Schema:**
```json
{
  "acknowledgment": {
    "type": "text",
    "example": "SIF start"
  },
  "data": {
    "type": "binary",
    "size": "256-512 bytes",
    "format": "Raw EEPROM dump following SFF-8472 specification"
  }
}
```

---

### 4. SFP: Write EEPROM

**Description:** Initiates a write to the SFP module's EEPROM. This command puts the device in a state to receive binary data.

**Endpoint:** `[POST] /sif/write`

**Request Format:**
```
Type: Text (UTF-8)
Payload: "[POST] /sif/write"
```

**Response Flow:**

1. **Text Acknowledgment** (on DC272A22-43F2-416B-8FA5-63A071542FAC)
   ```
   Type: Text (UTF-8)
   Example: "SIF write start"
   ```

2. **Client Action: Send Binary Data**
   - Send raw EEPROM .bin data to the Write characteristic (9280F26C-A56F-43EA-B769-D5D732E1AC67)
   - Data may need to be chunked due to BLE MTU limitations (typically 20-244 bytes)
   - Send all chunks sequentially

3. **Completion Acknowledgment** (Assumed - on DC272A22-43F2-416B-8FA5-63A071542FAC)
   ```
   Type: Text (UTF-8)
   Expected: "SIF write complete" or "SIF write stop"
   ```

**Request Schema:**
```json
{
  "type": "text",
  "payload": "[POST] /sif/write"
}
```

**Response Schema:**
```json
{
  "acknowledgment": {
    "type": "text",
    "example": "SIF write start"
  },
  "client_action": {
    "description": "Client must send raw EEPROM binary to write characteristic",
    "characteristic": "9280F26C-A56F-43EA-B769-D5D732E1AC67",
    "chunking": "Required - chunk size dependent on BLE MTU (typically 20-244 bytes)"
  },
  "completion": {
    "type": "text",
    "expected": "SIF write complete or SIF write stop"
  }
}
```

**Write Procedure:**
1. Send text command `[POST] /sif/write` to Write characteristic
2. Wait for `SIF write start` acknowledgment on Notify characteristic
3. Chunk EEPROM data into MTU-appropriate sizes (recommend 20 bytes for compatibility)
4. Send each chunk to Write characteristic sequentially
5. Wait for completion message on Notify characteristic

**Safety Considerations:**
- Always backup original EEPROM before writing
- Verify data integrity before initiating write
- Monitor for error messages during write process
- Consider implementing read-back verification after write

---

### 5. SFP: Erase EEPROM

**Description:** Triggers an erase operation on the SFP module's EEPROM.

**Endpoint:** `[POST] /sif/erase`

**Request Format:**
```
Type: Text (UTF-8)
Payload: "[POST] /sif/erase"
```

**Response Flow:**

1. **Erase Start Acknowledgment** (on DC272A22-43F2-416B-8FA5-63A071542FAC)
   ```
   Type: Text (UTF-8)
   Example: "SIF erase start"
   ```

2. **Erase Complete Acknowledgment** (on DC272A22-43F2-416B-8FA5-63A071542FAC)
   ```
   Type: Text (UTF-8)
   Example: "SIF erase stop"
   ```

**Request Schema:**
```json
{
  "type": "text",
  "payload": "[POST] /sif/erase"
}
```

**Response Schema:**
```json
{
  "type": "text",
  "start_message": "SIF erase start",
  "stop_message": "SIF erase stop"
}
```

**Warning:** Erasing EEPROM is destructive. Always backup module data before erasing.

---

### 6. SFP: Stop Operation

**Description:** A command to stop the current SFP interface operation.

**Endpoint:** `[POST] /sif/stop`

**Alternate Endpoint:** `/api/1.0/sif/stop`

**Request Format:**
```
Type: Text (UTF-8)
Payload: "[POST] /sif/stop"
```

**Response Format:**
```
Channel: DC272A22-43F2-416B-8FA5-63A071542FAC (Notify)
Type: Text (UTF-8)
Expected: "SIF stop" (assumed)
```

**Request Schema:**
```json
{
  "type": "text",
  "payload": "[POST] /sif/stop"
}
```

**Response Schema:**
```json
{
  "type": "text",
  "example": "SIF stop"
}
```

---

## Protocol Notes

### Text vs Binary Detection
The device sends both text and binary data on the same Notify characteristic (DC272A22-43F2-416B-8FA5-63A071542FAC). Client applications should implement heuristic detection:

- **Text Data:** All bytes are printable ASCII (32-126) or whitespace (9, 10, 13)
- **Binary Data:** Contains non-printable bytes

### MTU Considerations
- Default BLE MTU is typically 23 bytes (20 bytes of payload after ATT overhead)
- Negotiated MTU can be up to 517 bytes in BLE 4.2+
- For maximum compatibility, chunk write data into 20-byte segments
- Some devices support larger MTU negotiation - test with your specific device

### Command Format
All text commands follow a REST-like pattern:
- `[HTTP_METHOD] /endpoint`
- Examples: `[GET] /stats`, `[POST] /sif/start`
- Some endpoints omit the HTTP method prefix: `/api/1.0/version`

### Error Handling
Error responses have not been fully documented. Monitor the Notify characteristic for:
- Text messages containing "error", "failed", or similar keywords
- Unexpected responses to commands
- Timeout conditions (no response within expected timeframe)

### Timing
- Allow sufficient time between commands for device processing
- Wait for acknowledgment before sending binary data during writes
- Monitor for completion messages before initiating new operations

---

## Implementation Examples

### JavaScript/Web Bluetooth

#### Connecting to Device
```javascript
const SERVICE_UUID = "8E60F02E-F699-4865-B83F-F40501752184";
const WRITE_CHAR_UUID = "9280F26C-A56F-43EA-B769-D5D732E1AC67";
const NOTIFY_CHAR_UUID = "DC272A22-43F2-416B-8FA5-63A071542FAC";

const device = await navigator.bluetooth.requestDevice({
  filters: [{ services: [SERVICE_UUID] }]
});

const server = await device.gatt.connect();
const service = await server.getPrimaryService(SERVICE_UUID);
const writeChar = await service.getCharacteristic(WRITE_CHAR_UUID);
const notifyChar = await service.getCharacteristic(NOTIFY_CHAR_UUID);

await notifyChar.startNotifications();
notifyChar.addEventListener('characteristicvaluechanged', handleNotification);
```

#### Sending Commands
```javascript
async function sendCommand(command) {
  const encoder = new TextEncoder();
  const data = encoder.encode(command);
  await writeChar.writeValueWithoutResponse(data);
}

// Get version
await sendCommand("/api/1.0/version");

// Get status
await sendCommand("[GET] /stats");

// Read EEPROM
await sendCommand("[POST] /sif/start");
```

#### Writing EEPROM
```javascript
async function writeEEPROM(binaryData) {
  // 1. Initiate write mode
  await sendCommand("[POST] /sif/write");

  // 2. Wait for acknowledgment (monitor notifications)
  await waitForMessage("SIF write start");

  // 3. Chunk and send data
  const chunkSize = 20; // Conservative for compatibility
  const chunks = Math.ceil(binaryData.byteLength / chunkSize);

  for (let i = 0; i < chunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, binaryData.byteLength);
    const chunk = binaryData.slice(start, end);
    await writeChar.writeValueWithoutResponse(chunk);
    await delay(10); // Small delay between chunks
  }

  // 4. Wait for completion
  // Device can respond with either "SIF write stop" or "SIF write complete"
  await Promise.race([
    waitForMessage("SIF write stop"),
    waitForMessage("SIF write complete")
  ]);
}
```

---

## Testing Recommendations

1. **Always test with non-critical modules first**
2. **Backup EEPROM data before any write operations**
3. **Verify firmware version matches this specification (v1.0.10)**
4. **Monitor all notification messages during operations**
5. **Implement timeouts for all operations**
6. **Test write operations with read-back verification**
7. **Use BLE sniffers (nRF Sniffer, Ubertooth) to capture traffic for debugging**

---

## Known Limitations

1. **Firmware Version Dependency:** This specification is based on firmware v1.0.10. Behavior may change in future firmware versions.
2. **Error Codes:** Specific error codes and messages have not been fully documented.
3. **Secondary Notify Characteristic:** The purpose of UUID D587C47F-AC6E-4388-A31C-E6CD380BA043 is not fully understood.
4. **Write Verification:** No documented endpoint for verifying write success beyond read-back comparison.
5. **Concurrent Operations:** Behavior when multiple operations overlap is unknown.

---

## Safety Warnings

**CRITICAL WARNINGS:**
- Writing incorrect EEPROM data can permanently damage modules
- Always backup original EEPROM before writing
- Never write to production modules until fully tested
- Some SFP modules have write-protection that could be bypassed
- Vendor lock-in mechanisms may be intentional (compatibility, warranty)

**Recommended Safeguards:**
- Require user confirmation with warning message
- Validate EEPROM data format before write
- Implement read-back verification
- Add "dry run" mode for testing
- Log all write operations
- Provide rollback/restore functionality

---

## Future Research

1. **Error Response Format:** Document specific error messages and codes
2. **Secondary Notify Characteristic:** Determine purpose and usage
3. **Write Verification:** Investigate if device provides checksums or verification
4. **Firmware Update Protocol:** Document if BLE supports firmware updates
5. **Advanced Features:** Investigate any undocumented endpoints or capabilities

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11-02 | Initial documentation based on reverse engineering of firmware v1.0.10 |

---

## License & Disclaimer

This documentation is provided as-is for educational and interoperability purposes. It is not affiliated with or endorsed by the device manufacturer. Use at your own risk.
