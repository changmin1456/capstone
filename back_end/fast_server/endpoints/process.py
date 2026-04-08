from fastapi import APIRouter

router = APIRouter(tags=["process"])


@router.get("/process/ping")
def process_ping():
    return {"message": "process alive"}

