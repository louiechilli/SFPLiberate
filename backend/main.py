from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field
from typing import List, Optional
import base64
import datetime
import os
import json
import uuid
import hashlib

# Import our custom modules
import database_manager
import sfp_parser

app = FastAPI(
    title="SFP Wizard Backend API",
    description="A backend to store and serve SFP module EEPROM data.",
    version="1.0.0"
)

try:
    # Enable permissive CORS by default for easier local development.
    # When deployed behind the frontend reverse proxy, same-origin will apply.
    from fastapi.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
except Exception:
    # CORS is optional; don't fail if middleware is unavailable.
    pass

# --- Pydantic Models (Define API Data Shapes) ---

class SfpModuleIn(BaseModel):
    """The shape of data we expect when a user saves a new module."""
    name: str = Field(..., description="A friendly name for the module, e.g., 'Cisco 10G Copper'")
    
    # We'll receive the binary data as a Base64-encoded string
    # This is the standard way to send binary data in a JSON payload.
    eeprom_data_base64: str = Field(..., description="The raw SFP EEPROM data, Base64 encoded.")

class SfpModuleInfo(BaseModel):
    """The shape of data we send for the 'get all modules' list."""
    id: int
    name: str
    vendor: str
    model: str
    serial: str
    created_at: datetime.datetime

class StatusMessage(BaseModel):
    """A simple status message response."""
    status: str
    message: str
    id: Optional[int] = None


# --- API Endpoints ---

@app.on_event("startup")
async def startup_event():
    """This runs once when the API server starts."""
    database_manager.setup_database()

@app.get("/api/modules", response_model=List[SfpModuleInfo])
async def get_all_saved_modules():
    """
    Get a list of all SFP modules saved in the database.
    This does NOT include the large EEPROM data blob.
    """
    modules_from_db = database_manager.get_all_modules()
    # Convert list of Row objects to a list of dicts for Pydantic
    return [dict(module) for module in modules_from_db]

@app.post("/api/modules", response_model=StatusMessage)
async def save_new_module(module: SfpModuleIn):
    """
    Save a newly read SFP module. The frontend sends the
    raw EEPROM data, and this endpoint parses it before saving.
    """
    try:
        # Decode the Base64 data from the frontend
        eeprom_data = base64.b64decode(module.eeprom_data_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Base64 data.")

    # Use our parser to extract info
    parsed_info = sfp_parser.parse_sfp_data(eeprom_data)
    
    # Save to the database
    new_id, is_duplicate = database_manager.add_module(
        name=module.name,
        vendor=parsed_info["vendor"],
        model=parsed_info["model"],
        serial=parsed_info["serial"],
        eeprom_data=eeprom_data
    )
    status = "duplicate" if is_duplicate else "success"
    message = (f"Module already exists (SHA256 match). Using existing ID {new_id}."
               if is_duplicate else f"Module '{module.name}' saved.")
    return {"status": status, "message": message, "id": new_id}

# TODO: Add endpoint to import a module from the community index
# Example: POST /api/modules/import { name, vendor, model, serial, blob_url }
# The server would fetch the binary from blob_url, validate size/hash, and persist.

class CommunitySubmissionIn(BaseModel):
    name: str
    vendor: Optional[str] = None
    model: Optional[str] = None
    serial: Optional[str] = None
    eeprom_data_base64: str
    notes: Optional[str] = None

class CommunitySubmissionOut(BaseModel):
    status: str
    message: str
    inbox_id: str
    sha256: str

@app.post("/api/submissions", response_model=CommunitySubmissionOut)
async def submit_to_community(payload: CommunitySubmissionIn):
    """
    Accepts a user submission without requiring GitHub sign-in.
    Stores the submission in an inbox on disk for maintainers to triage and publish.
    """
    try:
        eeprom = base64.b64decode(payload.eeprom_data_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Base64 data.")

    sha = hashlib.sha256(eeprom).hexdigest()
    inbox_root = os.environ.get("SUBMISSIONS_DIR", "/app/data/submissions")
    os.makedirs(inbox_root, exist_ok=True)
    inbox_id = str(uuid.uuid4())
    target_dir = os.path.join(inbox_root, inbox_id)
    os.makedirs(target_dir, exist_ok=True)

    # Write files
    with open(os.path.join(target_dir, "eeprom.bin"), "wb") as f:
        f.write(eeprom)
    meta = {
        "name": payload.name,
        "vendor": payload.vendor,
        "model": payload.model,
        "serial": payload.serial,
        "sha256": sha,
        "notes": payload.notes,
        "created_at": datetime.datetime.utcnow().isoformat() + "Z",
    }
    with open(os.path.join(target_dir, "metadata.json"), "w") as f:
        json.dump(meta, f, indent=2)

    return {
        "status": "queued",
        "message": "Submission stored for review.",
        "inbox_id": inbox_id,
        "sha256": sha,
    }

@app.get("/api/modules/{module_id}/eeprom")
async def get_module_eeprom_data(module_id: int):
    """
    Get the raw binary EEPROM data for a specific module.
    This is what the frontend will fetch when the user clicks "Write".
    """
    eeprom_data = database_manager.get_module_eeprom(module_id)
    if not eeprom_data:
        raise HTTPException(status_code=404, detail="Module not found.")
    
    # Return the raw binary data
    return Response(content=eeprom_data, media_type="application/octet-stream")

@app.delete("/api/modules/{module_id}", response_model=StatusMessage)
async def delete_saved_module(module_id: int):
    """Delete a module from the database."""
    if database_manager.delete_module(module_id):
        return {"status": "success", "message": "Module deleted."}
    else:
        raise HTTPException(status_code=404, detail="Module not found.")
