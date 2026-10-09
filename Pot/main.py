from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
import uvicorn as corn
from asyncio.exceptions import CancelledError
import logging
import sys

from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager
from .config import settings, Settings
from Pot.core.log import module_log
from Pot.core.asr import asr_registry
from Pot.core.downstream import transcript_dispatcher

from Pot.api.v1.routes.debug import debugRouter
from Pot.api.v1.routes.signaling import signalingRouter
from Pot.api.v1.routes.sessions import sessionsRouter

from fastapi.middleware.cors import CORSMiddleware

logger = module_log(__name__)

def create_app(config: Settings) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        await asr_registry.stop_all()
        await transcript_dispatcher.stop()

    app = FastAPI(
        title=config.app_info_name,
        version=config.app_info_version,
        description=config.app_info_description,
        contact={
            "email": config.app_contact_email,
            "phone": config.app_contact_phone,
        },
        debug=True if config.profile.lower() == "dev" else False,
        lifespan=lifespan,
    )
    app.config = config

    @app.get("/health", tags=["system"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": config.app_info_name, "version": config.app_info_version}

    # Enable CORS for external frontend & mobile clients
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        # WebSocket peer identity/capabilities are carried by the connection;
        # the MVP does not use browser cookies or credentialed CORS.
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # include the debug router and expose its endpoints
    # if the application is in development profile
    if config.profile == "dev":
        logger.warning("Including Debug router")
        app.include_router(debugRouter, prefix="/debug")

    # Centralized audio room WebSocket — always active
    logger.info("Including audio room router")
    app.include_router(signalingRouter, prefix="/rtc")

    # Meeting session lifecycle endpoints (create/get/end meeting, audio ingest)
    logger.info("Including Sessions router")
    app.include_router(sessionsRouter, prefix="/rtc")
    
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


# ASGI entrypoint used by uvicorn/gunicorn and by local integration checks.
# Keeping one app instance also preserves the in-process room/session managers
# used by this MVP.
app = create_app(settings)

def main():
    server_config = corn.Config(
        app=app,
        host="0.0.0.0",
        port=9030,
        reload=True if settings.profile.lower() == "dev" else False,
        log_level="debug" if settings.profile.lower() == "dev" else "info",
        # Room/session state is intentionally in-process. Multiple workers
        # would split signaling state and make reconnects appear phantom.
        workers=1,
    )

    server = corn.Server(config=server_config)
    try:
        server.run()
    except (CancelledError, KeyboardInterrupt):
        logger.info("[+] Exiting the application")
        sys.exit(0)


if __name__ == "__main__":
    main()
