"""Room-scoped bridge to the existing Node meeting analyzer WebSocket."""

from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import websockets

from Pot.config import settings
from Pot.core.log import module_log

logger = module_log(__name__)


class AnalysisBridge:
    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task] = {}
        self._sockets: dict[str, Any] = {}
        self._queues: dict[str, asyncio.Queue] = {}
        self._stopping: set[str] = set()

    def enabled(self) -> bool:
        return bool(settings.analyzer_ws_url and settings.analyzer_user_id)

    async def start(self, room_id: str, publish) -> None:
        if not self.enabled() or room_id in self._tasks:
            return
        self._stopping.discard(room_id)
        self._queues.setdefault(room_id, asyncio.Queue(maxsize=256))
        self._tasks[room_id] = asyncio.create_task(self._run(room_id, publish))

    async def _run(self, room_id: str, publish) -> None:
        try:
            while room_id not in self._stopping:
                try:
                    url = self._url(room_id)
                    async with websockets.connect(url, max_size=64 * 1024) as socket:
                        self._sockets[room_id] = socket
                        await socket.send('{"type":"get_state"}')
                        reader = asyncio.create_task(self._read(room_id, socket, publish))
                        writer = asyncio.create_task(self._write(room_id, socket))
                        done, pending = await asyncio.wait(
                            {reader, writer}, return_when=asyncio.FIRST_COMPLETED
                        )
                        for task in pending:
                            task.cancel()
                        await asyncio.gather(*pending, return_exceptions=True)
                        for task in done:
                            task.result()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    self._sockets.pop(room_id, None)
                    if room_id not in self._stopping:
                        logger.warning("Analyzer bridge retry for %s: %s", room_id, exc)
                        await asyncio.sleep(2)
        except asyncio.CancelledError:
            raise
        finally:
            self._sockets.pop(room_id, None)
            self._tasks.pop(room_id, None)

    async def _read(self, room_id: str, socket, publish) -> None:
        async for raw in socket:
            try:
                message = json.loads(raw)
            except (TypeError, ValueError):
                logger.warning("Ignoring invalid analyzer message for %s", room_id)
                continue
            if message.get("type") == "update" and isinstance(message.get("data"), dict):
                await publish(room_id, {"type": "update", "data": message["data"]})

    async def _write(self, room_id: str, socket) -> None:
        queue = self._queues[room_id]
        while True:
            event = await queue.get()
            try:
                await socket.send(json.dumps({
                    "type": "transcript",
                    "timestamp": event.get("created_at"),
                    "text": event.get("text"),
                }))
            except Exception:
                # Keep the accepted event for the reconnecting analyzer.
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    logger.warning("Analyzer queue full while restoring %s", room_id)
                raise

    async def send_transcript(self, room_id: str, event: dict) -> None:
        if room_id not in self._queues and room_id not in self._stopping:
            self._queues[room_id] = asyncio.Queue(maxsize=256)
        queue = self._queues.get(room_id)
        if queue is None:
            return
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("Analyzer queue full; dropping oldest event for %s", room_id)
            queue.get_nowait()
            queue.put_nowait(event)

    async def stop(self, room_id: str) -> None:
        self._stopping.add(room_id)
        task = self._tasks.get(room_id)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self._sockets.pop(room_id, None)
        self._queues.pop(room_id, None)
        self._tasks.pop(room_id, None)

    def _url(self, room_id: str) -> str:
        parsed = urlparse(settings.analyzer_ws_url)
        query = dict(parse_qsl(parsed.query))
        query.update({"userId": settings.analyzer_user_id, "roomId": room_id})
        return urlunparse(parsed._replace(query=urlencode(query)))


analysis_bridge = AnalysisBridge()
