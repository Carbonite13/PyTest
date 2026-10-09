# Pages Router serving UI pages via Jinja2 templates
# Renders pages from the Tea/ UI directory with proper logging

from pathlib import Path
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from Pot.config import settings
from Pot.core.log import module_log

__all__ = ["pagesRouter"]

logger = module_log(__name__)

pagesRouter = APIRouter(
    tags=["pages"],
)

# Resolve template directory from settings or project structure
tea_dir = Path(settings.app_root) / "Tea"
templates = Jinja2Templates(directory=str(tea_dir))


@pagesRouter.get("/", response_class=HTMLResponse)
async def get_index(request: Request):
    """Render main application UI"""
    logger.info("Serving index page (index.html)")
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"app_name": settings.app_info_name, "version": settings.app_info_version},
    )


@pagesRouter.get("/about", response_class=HTMLResponse)
async def get_about(request: Request):
    """Render about page if template exists, fallback to JSON or default page"""
    about_path = tea_dir / "about.html"
    if about_path.exists():
        logger.info("Serving about page (about.html)")
        return templates.TemplateResponse(
            request=request,
            name="about.html",
            context={"app_name": settings.app_info_name, "version": settings.app_info_version},
        )
    logger.info("Serving default index page for /about")
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"app_name": settings.app_info_name, "version": settings.app_info_version},
    )
