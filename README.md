# 🖊️ Pen Fight - Real-Time Multiplayer & Solo Physics Game

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
[![Phaser 3](https://img.shields.io/badge/Phaser_3-8B5CF6?style=for-the-badge&logo=phaser&logoColor=white)](https://phaser.io/)
[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)

A modern, web-based physics game inspired by the classic school classroom game **Pen Fight**. Aim your pen, unleash calculated flick shots, and push your opponent off the desk arena while staying inside the boundaries!

---

## 🎮 Game Modes

- 🤖 **Single Player (vs Computer AI):** Play offline against an intelligent bot featuring dynamic power scaling, distance calculation, human-like aim variance, and visual trajectory aiming.
- 🌐 **Real-Time Online Multiplayer:** Create custom rooms or join with a 4-letter room code to challenge friends across browsers in real-time.

---

## ✨ Key Technical Highlights

1. **Matter.js 2D Physics Engine:**
   - Realistic top-down friction, linear drag, restitution (bounce), and angular velocity simulate pen rotation and sliding dynamics.
2. **Authoritative Kinematic Physics Synchronization:**
   - Eliminates the cross-browser physics desync ("the butterfly effect") caused by differing client frame rates.
   - The active shooting client simulates the rigid-body mechanics and continuously broadcasts real-time coordinate packets over WebSockets; the passive client mirrors the trajectory authoritatively.
3. **Seamless Canvas Letterboxing (`Phaser.Scale.FIT`):**
   - Standardized 1400x900 logical physics coordinate space with auto-centering and background matching for an invisible letterboxing experience on any display.
4. **Resilient Match Reset:**
   - State-level soft resets allow immediate consecutive rematches without tearing down the underlying WebSocket connections.

---

## 🛠️ Tech Stack

- **Frontend:**
  - [React 19](https://react.dev/) + [Vite](https://vitejs.dev/)
  - [TypeScript](https://www.typescriptlang.org/)
  - [Phaser 3](https://phaser.io/) with Matter.js physics
- **Backend:**
  - [Python 3.12](https://python.org)
  - [FastAPI](https://fastapi.tiangolo.com/) + Uvicorn
  - Asynchronous WebSockets for state synchronization and room matchmaking

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+) & npm
- Python (v3.10+)

### 1. Backend Setup
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
Backend will be available at `http://localhost:8000`.

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## 📂 Project Structure

```
Pen Fight/
├── backend/
│   ├── main.py              # FastAPI app, WebSocket room manager & broadcaster
│   └── requirements.txt     # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── game/
│   │   │   ├── Game.ts      # Phaser Game initialization & configuration
│   │   │   └── scenes/
│   │   │       └── MainScene.ts # Matter.js arena, pen physics, AI logic, & WS sync
│   │   ├── App.tsx          # React lobby & room manager
│   │   └── App.css          # UI styles & responsive layout
│   └── package.json
└── README.md
```

---

## 📄 License
This project is open-source and available under the [MIT License](LICENSE).
