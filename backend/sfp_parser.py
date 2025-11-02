def parse_sfp_data(eeprom_data: bytes) -> dict:
    """
    Parses the raw SFP EEPROM data (Address A0h) to extract
    key information based on the SFF-8472 standard.

    The eeprom_data is expected to be at least 128 bytes.
    """
    if len(eeprom_data) < 96:
        # Not enough data to parse.
        return {
            "vendor": "Unknown",
            "model": "Unknown",
            "serial": "Unknown",
        }

    # SFF-8472 specifies these byte ranges for Address A0h
    # .strip() removes padding, and decode('ascii', 'ignore') handles
    # any non-printable characters.
    vendor_name = eeprom_data[20:36].decode('ascii', 'ignore').strip()
    part_number = eeprom_data[40:56].decode('ascii', 'ignore').strip()
    serial_number = eeprom_data[68:84].decode('ascii', 'ignore').strip()

    # Based on your log file, the vendor was "OEM" and model "SFP-H10GB-CU1M"
    # This logic will extract that automatically.
    
    return {
        "vendor": vendor_name or "N/A",
        "model": part_number or "N/A",
        "serial": serial_number or "N/A",
    }