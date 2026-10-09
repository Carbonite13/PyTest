from fastapi import FastAPI

from Pot.main import app


def test_module_exposes_asgi_app_and_meeting_routes():
    assert isinstance(app, FastAPI)
    routes = set(app.openapi()["paths"])
    assert "/" in routes
    assert "/health" in routes
    assert "/rtc/sessions" in routes
    assert "/rtc/rooms" in routes
    websocket_paths = {
        route.path
        for router in app.routes
        if hasattr(router, "original_router")
        for route in router.original_router.routes
        if route.__class__.__name__ == "APIWebSocketRoute"
    }
    assert any(path.endswith("/ws") for path in websocket_paths)
