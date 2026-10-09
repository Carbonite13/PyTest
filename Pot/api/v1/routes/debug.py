# Debug router
# explore and verify runtime variables from the configuration
# and other sides of the application

from Pot.config import settings
from fastapi import APIRouter
from fastapi.responses import JSONResponse

__all__ = ["debugRouter"]

debugRouter = APIRouter(
    tags=["debug"],
)

@debugRouter.get("/db")
async def test_db():
    """Explore Database runtime configurations"""
    return {
        "db_hostname": "[+]" if settings.db_hostname else "[-]",
        "db_port": settings.db_port,
        "db_name": settings.db_name,
        "db_username": settings.db_username,
        "db_password": "[+]" if settings.db_password else "[-]",
        "db_external_url": "[+]" if settings.db_external_url else "[-]",
    }

@debugRouter.get("/app")
async def test_app():
    return {
        "app_info_name": settings.app_info_name,
        "app_info_version": settings.app_info_version,
        "app_info_author": settings.app_info_author,
        "app_info_description": settings.app_info_description,
        "app_contact_email": settings.app_contact_email,
        "app_contact_phone": settings.app_contact_phone,
    }

@debugRouter.get("/paths")
async def test_paths():
    return {
        "app_root": settings.app_root,
        "log_directory": settings.log_directory,
        "data_directory": settings.data_directory,
        "template_root": settings.template_root,
    }

@debugRouter.get("/perm")
async def test_perm():
    return {
        "perm_directory_create": settings.perm_directory_create,
    }

@debugRouter.get("/rtc")
async def test_rtc():
    """Explore WebRTC runtime configurations"""
    return {
        "stun_server": settings.stun_server,
        "turn_server": "[+]" if settings.turn_server else "[-]",
        "turn_username": "[+]" if settings.turn_username else "[-]",
        "turn_credential": "[+]" if settings.turn_credential else "[-]",
    }