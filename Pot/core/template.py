from jinja2 import Environment, FileSystemLoader

from Pot.config import settings

__all__ = ["env"]

env = Environment(
    auto_reload=True if settings.profile == "dev" else False,
    autoescape=select_autoescape(["html", "htm"]),
    cache_size=0 if settings.profile == "dev" else 100000,
    loader=FileSystemLoader(settings.template_root)
)