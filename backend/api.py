from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}

# placeholder: AHK will call this later
@app.get("/next_event")
def next_event():
    # for now, just return a dummy event
    return JSONResponse({
        "event": "none",
        "ship": None,
        "confidence": 0.0
    })
