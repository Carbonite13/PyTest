from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
import uvicorn as corn
from asyncio.exceptions import CancelledError
import logging
import sys

from pathlib import Path
from typing import Optional
from .config import settings, Settings
from Pot.core.log import module_log

from Pot.api.v1.routes.debug import debugRouter
from Pot.api.v1.routes.signaling import signalingRouter

from fastapi.middleware.cors import CORSMiddleware

logger = module_log(__name__)

def create_app(config: Settings) -> FastAPI:
    app = FastAPI(
        title=config.app_info_name,
        version=config.app_info_version,
        description=config.app_info_description,
        contact={
            "email": config.app_contact_email,
            "phone": config.app_contact_phone,
        },
        debug=True if config.profile.lower() == "dev" else False
    )
    app.config = config

    # Enable CORS for external frontend & mobile clients
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # include the debug router and expose its endpoints
    # if the application is in development profile
    if settings.profile == "dev":
        logger.warn("Including Debug router")
        app.include_router(debugRouter, prefix="/debug")

    # WebRTC signaling router — always active
    logger.info("Including WebRTC signaling router")
    app.include_router(signalingRouter, prefix="/rtc")
    
    # UI Pages router
    from Pot.api.v1.routes.pages import pagesRouter
    logger.info("Including UI Pages router")
    app.include_router(pagesRouter)

    # configure Static paths
    tea_dir = Path(config.app_root) / "Tea"
    if tea_dir.exists():
        logger.info(f"Mounting static files from {tea_dir}")
        for subfolder in ["css", "js", "assets", "vendors"]:
            subpath = tea_dir / subfolder
            if subpath.exists():
                app.mount(f"/{subfolder}", StaticFiles(directory=str(subpath)), name=subfolder)
        app.mount("/static", StaticFiles(directory=str(tea_dir)), name="static")

    return app

def main():
    app = create_app(settings)
    server_config = corn.Config(
        app=app,
        host="0.0.0.0",
        port=9030,
        reload=True if settings.profile.lower() == "dev" else False,
        log_level="debug" if settings.profile.lower() == "dev" else "info",
        workers=4,
    )

    server = corn.Server(config=server_config)
    try:
        server.run()
    except (CancelledError, KeyboardInterrupt):
        logger.info("[+] Exiting the application")
        sys.exit(0)