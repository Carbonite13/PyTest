# DEFINE 4.0

The official project submission repository for **DEFINE 4.0 — The World's Realest Hackathon**.

---

# TeaPot
## Meeting system audit

The current implementation is a FastAPI signaling relay with browser-to-browser
WebRTC media. Meeting state and WebSocket rooms are in-process and therefore
run with one worker. Client transcription sends versioned text events only; the
server rejects raw audio uploads. See [Pot/docs/backend_architecture.md](Pot/docs/backend_architecture.md),
[Pot/docs/webrtc.md](Pot/docs/webrtc.md), and [Pot/docs/endpoints.md](Pot/docs/endpoints.md)
for lifecycle, signaling, privacy, deployment, and testing details.

## Local development

### Prerequisites

- Python 3.11, 3.12, or 3.13
- Node.js 22 or newer
- Poetry 2 or newer
- A Supabase project and Groq API key for live analysis

The supported Python range is declared in
[pyproject.toml](./pyproject.toml). Python 3.11 is used by the current test
environment.

### FastAPI signaling service

1. Copy `Pot/config/.env.example` to `Pot/.env`.
2. Fill in the required application and database metadata fields.
3. Install the server and test dependency groups:

   ```powershell
   poetry install --with server,test
   ```

4. Run the API:

   ```powershell
   python -m Pot.main
   ```

   The development server listens on `0.0.0.0:9030`, so another device on
   the same Wi-Fi can open the frontend through the host computer's LAN
   address:

   ```text
   http://<host-lan-ip>:9030/static/index.html
   ```

   On Windows, find the Wi-Fi address with:

   ```powershell
   Get-NetIPAddress -AddressFamily IPv4 |
     Where-Object {$_.InterfaceAlias -match 'Wi-Fi' -and $_.IPAddress -notlike '169.254.*'} |
     Select-Object -ExpandProperty IPAddress
   ```

   Both devices must be on the same network, and Windows Firewall must allow
   inbound TCP traffic on port `9030` for the selected private network. Do
   not use `localhost` or `127.0.0.1` on the joining device.

### Node meeting analyzer

1. Install dependencies:

   ```powershell
   cd LLM
   npm install
   ```

2. Create `LLM/.env` with the existing analyzer settings, including
   `GROQ_API_KEY`, Supabase credentials, and `PORT` (default `3000`).
3. Start the analyzer:

   ```powershell
   npm run dev
   ```

4. Set these values in `Pot/.env` so FastAPI can bridge the existing analyzer
   WebSocket without exposing a second browser connection:

   ```env
   ANALYZER_WS_URL=ws://localhost:3000
   ANALYZER_USER_ID=<Supabase user UUID>
   ```

The browser sends transcript events to FastAPI. FastAPI forwards accepted
events to the analyzer and broadcasts structured analyzer updates back to the
meeting room. If either bridge setting is absent, WebRTC signaling continues
without live AI analysis.

### Tests

Run the backend tests with:

```powershell
python -m pytest -q Pot\tests
```

The tests require the non-secret required fields from `Pot/.env` to be
available as environment variables or in the local environment file.

## Team Information

- **Team Name**: PyTest
- **Track**: PS-07

## Team Members

| Name | Role | GitHub | LinkedIn |
|------|------|--------|----------|
| Adithyan L | Technical | [@Carbonite13](https://github.com/carbonite13) | [Profile](https://linkedin.com/in/adithyanaconitum) |
| Jeffin Mathew Abraham | Technical | [@Jeffin-co](https://github.com/JEFFIN-co) | [Profile](https://linkedin.com/in/) |
| Nasrin Hakkim | Technical | [@Nasrin-Hakkim](https://github.com/nasrinhakkim960-create) | [Profile](https://linkedin.com/in/username) |

---

# Project Details

## Overview

We are building a smart digital assistant that listens to meetings and automatically organizes the conversation in real-time. The goal is to free people from the stress of taking notes, so they can focus entirely on the discussion, while ensuring no important decision or task is ever lost or forgotten.

## Problem Statement

We are solving the problem of people missing important information and struggling to respond effectively during conversations because they have to listen, think, and speak at the same time. People are tired of remembering things and usually nobody is interested in taking notes. Through our solution people can stay focused and make better decisions with the help of our platform.

Explain:

- What is the problem?
  
  People struggle to listen, understand, think, and respond simultaneously during conversations. As a result, they may miss important 
  information, forget decisions ,forget their assigned tasks, or fail to respond effectively.
- Who is affected by it?
  
  Sales professionals during pitches and negotiations.
  Customer support agents handling calls.
  Employees participating in meetings and team discussions.
  Students and individuals involved in important conversations.
- Why is solving it important?
  
  Missing key details can lead to poor decisions, misunderstandings, missed opportunities, and forgotten action items.
- What are the limitations of existing solutions?
  
  Note-taking apps: Require users to divide their attention between listening and writing.
  
  Meeting transcription tools: Often focus on recording and summarising conversations rather than providing timely, goal-specific 
  assistance.
  
  AI chat assistants: May require users to switch applications or manually enter context, interrupting the conversation.
  
  Privacy concerns: Recording and processing confidential discussions can create security and trust issue

## Solution

Explain your proposed solution and how it addresses the identified problem.

We aim to build a **smart digital assistant** that listens to discussions and organizes important information in real time. Our goal is to reduce the burden of manual note-taking, allowing people to focus on conversations, actively participate, and make better decisions without worrying about missing important details.

The assistant will identify key discussion points, summarize important information, highlight decisions, track action items, and remind users of pending tasks or follow-ups. It will also provide relevant suggestions and contextual insights based on the user's objectives, helping them respond more confidently during meetings, sales pitches, negotiations, and support calls.

Designed to support both individual conversations and group discussions, the solution will offer a simple, unobtrusive interface that keeps essential information accessible without distracting users. **Privacy and confidentiality will remain core priorities**, with appropriate safeguards for handling sensitive conversations.

Ultimately, our goal is to transform conversations into clear, organized, and actionable outcomes—ensuring that important ideas are remembered, decisions are documented, and responsibilities are not forgotten.

Describe the core idea, workflow, and key technologies used to build the solution.

---

# Technical Implementation
## Technologies Used

| Category | Technologies |
|----------|--------------|
| **Frontend** | Technologies |
| **Backend** | Technologies |
| **Database** | Technologies |
| **APIs / Services** | Technologies |
| **AI / ML** | Technologies |
| **DevOps / Deployment** | Technologies |
| **Other Tools** | Technologies |

# Setup Instructions
## Installation
### 1. Clone the Repository

```bash
git clone <repository-url>
```
