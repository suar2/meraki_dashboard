import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.api.routes import router
from app.config import Settings, configure_logging, settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging()
    logger.info(
        "Starting backend env=%s backend_port=%s privacy_mode=strict-zero-retention",
        settings.app_env,
        settings.backend_port,
    )
    if settings.app_env == "production" and settings.secret_key == "change_this_to_a_random_long_string":
        logger.warning("SECRET_KEY uses default value. Replace it in production.")
    yield


app = FastAPI(title="Meraki Network Operations API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_store_api_responses(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
    return response


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/config-check")
async def config_check():
    try:
        _ = Settings()
        return {"status": "ok"}
    except ValidationError as exc:
        return JSONResponse(status_code=400, content={"status": "error", "message": str(exc)})


app.include_router(router)
