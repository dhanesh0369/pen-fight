from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List
import json
import uuid

app = FastAPI()

# Pen types the client knows how to render/simulate (see frontend/src/game/pens.ts)
VALID_PEN_TYPES = {"ballpoint", "marker", "gel"}
DEFAULT_PEN_TYPE = "ballpoint"

# Allow frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For MVP, allow all
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Connection Manager for WebSockets
class ConnectionManager:
    def __init__(self):
        # Maps game_id -> list of WebSockets
        self.active_games: Dict[str, List[WebSocket]] = {}
        # Maps game_id -> game state
        self.game_states: Dict[str, dict] = {}

    async def connect(self, websocket: WebSocket, game_id: str, pen_type: str = DEFAULT_PEN_TYPE) -> bool:
        await websocket.accept()
        if game_id not in self.active_games:
            self.active_games[game_id] = []
            self.game_states[game_id] = {
                "players": [],
                "turn": 1,
                "is_moving": False,
                "pens": {}
            }
        
        # Max 2 players per game for now
        if len(self.active_games[game_id]) < 2:
            self.active_games[game_id].append(websocket)
            player_num = len(self.active_games[game_id])
            self.game_states[game_id]["pens"][str(player_num)] = pen_type
            
            # Send initial assignment
            await websocket.send_json({
                "type": "init",
                "player_num": player_num,
                "game_id": game_id
            })
            
            # If game is full, start it
            if player_num == 2:
                await self.broadcast(game_id, {
                    "type": "game_start",
                    "state": self.game_states[game_id]
                })
            return True
        else:
            await websocket.send_json({"type": "error", "message": "Game is full"})
            await websocket.close()
            return False

    def disconnect(self, websocket: WebSocket, game_id: str):
        if game_id in self.active_games:
            if websocket in self.active_games[game_id]:
                self.active_games[game_id].remove(websocket)
            
            # If everyone left, clean up
            if len(self.active_games[game_id]) == 0:
                del self.active_games[game_id]
                del self.game_states[game_id]
            else:
                # Notify remaining player
                pass # Will implement broadcast

    async def broadcast(self, game_id: str, message: dict):
        if game_id in self.active_games:
            for connection in self.active_games[game_id]:
                await connection.send_json(message)

manager = ConnectionManager()

@app.get("/")
def read_root():
    return {"message": "Pen Fight Multiplayer API is running"}

@app.websocket("/ws/{game_id}")
async def websocket_endpoint(websocket: WebSocket, game_id: str, pen: str = DEFAULT_PEN_TYPE):
    pen_type = pen if pen in VALID_PEN_TYPES else DEFAULT_PEN_TYPE
    if not await manager.connect(websocket, game_id, pen_type):
        return  # Room was full; connection already closed
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Handle incoming game events
            if message["type"] in ["shoot", "sync", "sync_move", "restart"]:
                # Forward the event to the other player
                await manager.broadcast(game_id, message)
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, game_id)
        await manager.broadcast(game_id, {
            "type": "player_left",
            "message": "Opponent disconnected."
        })
