import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.api.routes import router
from app.config import Settings, configure_logging, settings
from app.services.meraki_client import MerakiAPIError, MerakiClient

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging()
    settings.ensure_data_dir()
    logger.info(
        "Starting backend env=%s backend_port=%s data_dir=%s meraki_api_key=%s",
        settings.app_env,
        settings.backend_port,
        settings.data_dir,
        settings.masked_api_key,
    )
    if settings.app_env == "production" and settings.secret_key == "change_this_to_a_random_long_string":
        logger.warning("SECRET_KEY uses default value. Replace it in production.")
    try:
        if settings.meraki_api_key:
            await MerakiClient().validate_credentials()
        else:
            logger.warning("MERAKI_API_KEY is not configured at startup; waiting for dashboard input.")
    except MerakiAPIError as exc:
        logger.error("Meraki startup credential check failed: %s", exc)
        raise
    yield


app = FastAPI(title="Meraki Network Operations API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
